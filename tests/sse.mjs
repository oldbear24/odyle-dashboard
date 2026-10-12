export async function connect(url, token) {
  const abort = new AbortController();
  const res = await fetch(url + '/api/realtime', { signal: abort.signal });
  const decoder = new TextDecoder();
  const queue = [], waiters = [];
  const push = event => { if (waiters.length) waiters.shift()(event); else queue.push(event); };
  const reading = (async () => {
    let buffer = '';
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const lines = frame.split('\n'), name = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
          if (name && data) push({ name, data: JSON.parse(data) });
        }
      }
    } catch (error) { if (!abort.signal.aborted) throw error; }
  })();
  const next = async (timeout = 1500) => {
    if (queue.length) return queue.shift();
    let receive;
    return await new Promise(resolve => {
      const timer = setTimeout(() => { const index = waiters.indexOf(receive); if (index >= 0) waiters.splice(index, 1); resolve(null); }, timeout);
      receive = value => { clearTimeout(timer); resolve(value); }; waiters.push(receive);
    });
  };
  const hello = await next();
  if (hello?.name !== 'PB_CONNECT') throw new Error('SSE handshake failed.');
  const subscription = await fetch(url + '/api/realtime', { method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: hello.data.clientId, subscriptions: ['members/*'] }) });
  if (!subscription.ok) throw new Error('SSE subscription rejected.');
  return { next, close: async () => { abort.abort(); await reading; } };
}
