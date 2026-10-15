// Rules that keep scripts/probe-tokens.js from sending a password or a token anywhere but the server
// it probes. They live apart from the probe so unit tests can check them without a server.

/** True when url is on exactly base's origin: scheme, host and port. False for a URL that doesn't parse. */
export const sameOrigin = (url, base) => {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
};

/** A URL's origin for a message, or "no address" for a URL that doesn't parse. */
export const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return "no address";
  }
};

/**
 * True when a login form may receive the password: the page, after any redirects, and the resolved
 * action of the password field's form are both on base's origin. A field outside a form gets nothing.
 */
export const loginFormSafe = ({ pageUrl, formAction }, base) =>
  Boolean(formAction) && sameOrigin(pageUrl, base) && sameOrigin(formAction, base);

/**
 * The fetch redirect mode for a request. A request that carries a token or a password never follows a
 * redirect, because Node's fetch re-sends the body on a 307 or 308, even to another origin.
 */
export const redirectModeFor = ({ token, params = {}, redirect }) => {
  if (token || Object.hasOwn(params, "password")) {
    return "manual";
  }
  return redirect ?? "follow";
};

/** Manual sign-in needs a window to sign in with, so it always shows the browser. */
export const runHeadless = ({ headed, manual }) => !(headed || manual);

/**
 * A Playwright route handler that adds headers only to requests on base's origin, and never to a
 * redirect. It fetches those requests itself without following redirects and hands the response to
 * the browser, which then requests a redirect's target without the headers. Requests to other
 * origins go out unchanged.
 */
export const sameOriginHeaders = (base, extraHeaders) => async (route) => {
  const request = route.request();
  if (!sameOrigin(request.url(), base)) {
    await route.continue();
    return;
  }
  const response = await route.fetch({ headers: { ...request.headers(), ...extraHeaders }, maxRedirects: 0 });
  await route.fulfill({ response });
};

/**
 * A Playwright route handler for a page opened with ?token=. It aborts any request that carries a
 * token parameter and isn't on base's origin, so a redirect that keeps the query string (to a portal
 * login, or to http://) fails there instead of handing the token to another host. Other requests go
 * out unchanged.
 */
export const urlTokenStaysHome = (base) => async (route) => {
  const url = route.request().url();
  if (!sameOrigin(url, base) && /[?&]token=/i.test(url)) {
    await route.abort();
    return;
  }
  await route.continue();
};
