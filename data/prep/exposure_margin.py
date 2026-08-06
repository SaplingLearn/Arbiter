"""Exposure margin arithmetic for R3.

Deliberately pure: no I/O, no config lookup, no data files. The rule that decides
every exposureRelevant value in the corpus should be readable in one screen and
testable without a network.

WHY None IS NOT False. R3 reads `exposureRelevant !== true`, so the engine treats
them identically and no verdict depends on the difference. The TRACE does:

    false -> "a negative result from testing outside the clinically relevant range"
    null  -> "whose exposure margin relative to the clinical range was never established"

The first is a claim about a measurement. Emitting it where nothing was measured
tells a toxicologist a fact nobody checked, which is exactly the overclaim this
module exists to remove - see the design spec section 3.
"""


def margin(top_tested_um: float | None, cmax_unbound_um: float | None) -> float | None:
    """How many multiples of unbound clinical exposure the assay actually reached.

    Returns None when either quantity is unavailable. Raises on a non-positive
    Cmax rather than returning infinity: a zero would clear any factor and mark
    every compound exposure-relevant, which is the silent-catastrophe direction.
    """
    if top_tested_um is None or cmax_unbound_um is None:
        return None
    if cmax_unbound_um <= 0:
        raise ValueError(
            f"cmax_unbound_um must be positive, got {cmax_unbound_um}. A zero or "
            "negative unbound Cmax produces an infinite margin that clears any "
            "factor, marking every compound exposure-relevant."
        )
    return top_tested_um / cmax_unbound_um


def exposure_relevant(
    top_tested_um: float | None,
    cmax_unbound_um: float | None,
    factor: float,
) -> bool | None:
    """The three-valued answer R3 consumes. `factor` comes from the registered policy."""
    m = margin(top_tested_um, cmax_unbound_um)
    if m is None:
        return None
    return m >= factor
