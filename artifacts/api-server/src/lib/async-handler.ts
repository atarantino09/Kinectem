import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wrap an async (or sync) Express handler so that any thrown error or
 * rejected promise is forwarded to Express's `next(err)` chain.
 *
 * Handlers used to be required to be `async` and `return` a Promise so that
 * `.catch(next)` would attach. In practice some handlers are written as
 * plain `(req, res) => { res.json(...) }` arrow functions that return
 * `undefined`. Calling `.catch(undefined)` throws a `TypeError` which then
 * pollutes the server log even though the response was sent successfully.
 *
 * Wrapping the call in `Promise.resolve(...)` makes the wrapper accept both
 * styles safely: thrown synchronous errors are converted to a rejection
 * (because the call is inside the Promise constructor's try-block via
 * `Promise.resolve().then(...)` semantics — `Promise.resolve(fn())` itself
 * still throws synchronously, so we wrap the whole call in a try/catch).
 */
export function asyncHandler(
  fn: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      Promise.resolve(result).catch(next);
    } catch (err) {
      next(err);
    }
  };
}
