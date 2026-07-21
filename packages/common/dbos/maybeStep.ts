import { DBOS } from "@dbos-inc/dbos-sdk"

// Wraps a function as a DBOS step inside a workflow (so replay reuses the result), or calls it directly otherwise.
export function maybeStep<Args extends unknown[], Return>(
    name: string,
    fn: (...args: Args) => Promise<Return>
): (...args: Args) => Promise<Return> {
    const stepWrapped = DBOS.registerStep(fn, { name })
    return (...args: Args) => DBOS.isWithinWorkflow() ? stepWrapped(...args) : fn(...args)
}
