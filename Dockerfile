# ARBITER, as one container.
#
# THIS IS NOT A PLAIN NODE APP. Two things about it are not visible from package.json,
# and both of them decide whether the image can run at all:
#
#   1. It shells out to Python. services/api/documents.ts runs
#      `data/prep/measure_pdf.py` against every uploaded PDF and
#      `data/prep/extract_pdf_text.py` before every Ask, and services/api/library.ts
#      runs the extractor over the shipped regulatory reviews. Without PyMuPDF in the
#      image, every upload comes back 422 "unreadable - PyMuPDF is not installed",
#      which reads as a bad DOCUMENT rather than a missing dependency. CI carries the
#      same install for the same reason (.github/workflows/ci.yml).
#   2. It runs from TypeScript source through tsx, which is a devDependency. See the
#      npm ci step.
#
# The first one is why an image built the obvious way starts, serves the case list, and
# fails only when somebody uploads a document.

# PYTHON IS THE BASE AND NODE IS COPIED IN, which is the opposite of the obvious
# arrangement. Debian bookworm - what node:22-bookworm-slim is built on - ships Python
# 3.11, and CI pins 3.12; `apt-get install python3` there gives an interpreter no
# reported number was measured on. Going the other way, both images are bookworm, so
# the node binary finds the glibc it was linked against.
FROM docker.io/library/python:3.12-slim-bookworm

# libstdc++6 is node's own dependency and is not in the python slim image; without it
# the copied binary dies with a missing shared library before it prints anything.
# ca-certificates is for the outbound TLS this service does - Anthropic, Vertex AI,
# Supabase - and its absence looks like a network failure rather than a missing
# trust store.
#
# tini is the ENTRYPOINT below, and it is not decoration. Measured on this image: with
# node as PID 1, `podman stop` waited the full grace period and reported "SIGTERM
# failed to stop container in 10 seconds, resorting to SIGKILL"; with an init in front
# it stopped in 0.2s. The kernel does not apply a signal's DEFAULT action to PID 1, and
# server.ts installs no SIGTERM handler, so the signal is simply discarded. The cost is
# not a slow deploy - it is that every redeploy kills the process mid-write, and the
# things it writes are an append to the hash chain and a whole-file rewrite of the
# account store. A truncated users.json is every account in the deployment.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libstdc++6 tini \
 && rm -rf /var/lib/apt/lists/*

# NODE 22, NOT 20, AND THE REASON IS A CRASH THIS IMAGE ACTUALLY PRODUCED.
#
# `@supabase/supabase-js` builds a Realtime client inside `createClient` whether or not
# anything subscribes to anything - this service uses Storage only and never opens a
# channel - and that constructor requires a global `WebSocket`. Node made it available
# unflagged in 22; on 20 it does not exist, so `createClient` throws
# "Node.js detected but native WebSocket not found" and the process dies during
# `buildStores`, before it listens.
#
# It was invisible everywhere except here. The suite passes on a developer machine
# running a newer Node, and CI never constructs a Storage client at all because it sets
# no SUPABASE_URL - so the first execution on Node 20 with Storage configured is the
# deployed container, which is exactly the place a startup crash costs the most.
# .github/workflows/ci.yml is pinned to 22 alongside this, so the version that runs the
# tests is the version that runs in production.
#
# Node 20 also reached end of life in April 2026, so this was overdue independently.
COPY --from=docker.io/library/node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=docker.io/library/node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version && npm --version

# PyMuPDF ALONE, pinned to the version in data/prep/requirements.txt, and not the rest
# of that file: the other entries there are the offline dataset toolchain (rdkit,
# pandas, scikit-learn) which no server path touches and which cost minutes to install.
# This list is "what the product needs at runtime", not "the requirements file minus
# what is slow" - if a server path ever shells out to a script needing more than fitz,
# it grows. The pin moves with data/prep/requirements.txt and with CI, together.
RUN pip install --no-cache-dir pymupdf==1.28.2

# THE WORKING DIRECTORY IS THE REPO ROOT, AND IT HAS TO STAY THERE AT RUN TIME TOO.
# buildDeps() reads rules/evidence-checklist-v1.0.json, prompts/adjudicator-v1.2.json
# and data/probe-case.json by CWD-relative path, library.ts reads
# data/library-sources.json at module load - before anything is listening - and the
# Python scripts are invoked as `data/prep/measure_pdf.py`. Started from anywhere else
# the process throws ENOENT on a JSON file during boot and never reaches its banner.
WORKDIR /app

# THE WHOLE REPO, COPIED BEFORE `npm ci` RATHER THAN THE MANIFESTS FIRST. The usual
# trick - copy package.json and package-lock.json, install, then copy the source - buys
# a cached install layer, and it needs every one of this repo's nine workspace
# manifests listed by hand (packages/*, apps/*, services/*). A list like that goes
# stale the first time somebody adds a workspace, and the failure is an image built
# against a subtly different dependency tree rather than a build that stops. A slow
# rebuild is cheaper than that. .dockerignore is what keeps this context small.
COPY . .

# DEV DEPENDENCIES INCLUDED, DELIBERATELY. `npm ci --omit=dev` produces an image that
# cannot start: the service runs from TypeScript source through tsx (package.json's
# `api` script is `tsx services/api/server.ts`), there is no compile step that would
# turn it into plain JavaScript, and tsx is a devDependency. The site build needs vite,
# which is also one. Two ways out were available and neither is better here - moving
# tsx and vite into `dependencies` misdescribes them for every other consumer of this
# repo, and adding a tsc emit step for the service means a second build target to keep
# honest for the sake of a smaller image.
#
# NODE_ENV IS NOT SET TO production ANYWHERE ABOVE THIS LINE, and that is load-bearing
# rather than an omission: npm reads it and `npm ci` under NODE_ENV=production omits
# devDependencies without being asked to. Setting it as a matter of habit gives the
# --omit=dev image by a route that leaves no --omit=dev in the file to find.
RUN npm ci

# The static site, built into the image: apps/deliberation, apps/landing, and
# tools/stage-site.mjs putting the client where the landing page's CTA points.
#
# AND THE API PROCESS BELOW SERVES IT, via ARBITER_STATIC_DIR (set further down). That
# is what makes this one container a whole product rather than half of one: the client
# makes SAME-ORIGIN /api calls and signs itself in on load, so a site served from a
# different origin than the API is a page that fails on its first request. One process
# on one port removes the reverse proxy this would otherwise need. See the README's
# "Deploying it".
RUN npm run site:build

# NOT ROOT. The service writes under results/ - uploaded documents, extraction caches,
# and the file stores when DATABASE_URL is absent - so the directory is created and
# owned here rather than left for the first write to fail on.
RUN useradd --create-home --uid 10001 arbiter \
 && mkdir -p results/documents results/library \
 && chown -R arbiter:arbiter /app
USER arbiter

# documents.ts and library.ts default to `python`, which on a host whose system Python
# has no PyMuPDF is an interpreter that will never have it. Named explicitly, because a
# silently-chosen interpreter is how this failure hid the first time
# (tools/dev-all.mjs says the same thing about the repo virtualenv).
ENV PYTHON=/usr/local/bin/python3

# server.ts reads PORT and defaults to 8787. Most hosts inject their own.
ENV PORT=8787
EXPOSE 8787

# The site built above, at the path it was built to. Set HERE rather than left to the
# deployment config, because unlike ARBITER_HOST this is not a decision about the
# environment - it is a fact about this image. `npm run site:build` ran during the build
# and put the files at exactly this path, so any deployment of this image that did not
# set it would be serving an API with a website sitting unused beside it on disk.
#
# Still overridable: a deployment that fronts the site from a CDN sets it to empty and
# gets the API-only behaviour back.
ENV ARBITER_STATIC_DIR=/app/apps/landing/dist

# ARBITER_HOST IS DELIBERATELY UNSET. The server binds loopback unless told otherwise,
# because it terminates no TLS, and inside a container loopback means nothing outside
# can reach it. That is the right default to keep and the wrong one to inherit by
# accident, so the deployment sets ARBITER_HOST=0.0.0.0 explicitly and says what is
# terminating TLS in front of it. fly.toml does exactly that; `docker run` needs
# `-e ARBITER_HOST=0.0.0.0` or the published port answers nothing.

# See the tini note above. Some runtimes supply their own init - Fly Machines do, and
# `docker run --init` does - and this is harmless there; it is the plain `docker run`
# and `podman run` case that needs it.
ENTRYPOINT ["/usr/bin/tini", "--"]

# `node --import tsx` rather than `npm run api`: npm would sit between init and the
# server as an extra process, and a SIGTERM that stops at npm leaves the server to be
# killed rather than shut down. This keeps `process.argv[1]` equal to the server's own
# path as well - which server.ts's run-as-script guard compares against
# `import.meta.url` to decide whether to listen at all.
CMD ["node", "--import", "tsx", "services/api/server.ts"]
