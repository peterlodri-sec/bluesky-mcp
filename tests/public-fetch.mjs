// Never contact Bluesky in this regression test. Fail any unexpected request.
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  if (url.origin !== 'https://public.api.bsky.app' ||
      url.pathname !== '/xrpc/app.bsky.actor.getProfile' ||
      url.searchParams.get('actor') !== 'example.test' ||
      new Headers(options?.headers).has('Authorization')) {
    throw new Error('Unexpected network request or credentials');
  }
  return Response.json({ did: 'did:plc:synthetic', handle: 'example.test' });
};
