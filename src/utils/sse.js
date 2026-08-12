function parseSseEvent(block = '') {
  const data = String(block)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();

  if (!data || data === '[DONE]') return null;
  return JSON.parse(data);
}

export async function readSseJson(response, onEvent) {
  if (!response?.body?.getReader) {
    throw new Error('AI provider returned a streaming response without a readable body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consume = async (flush = false) => {
    const blocks = buffer.split(/\r?\n\r?\n/);
    if (!flush) buffer = blocks.pop() || '';
    else buffer = '';

    for (const block of blocks) {
      const event = parseSseEvent(block);
      if (event) await onEvent(event);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      await consume(false);
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parseSseEvent(buffer);
      if (event) await onEvent(event);
    }
  } finally {
    reader.releaseLock();
  }
}
