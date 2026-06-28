export function splitMessage(text, maxLength = 3500) {
  if (!text) return [];
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let sliceIndex = remaining.lastIndexOf('\n', maxLength);
    if (sliceIndex < maxLength * 0.5) {
      sliceIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (sliceIndex < maxLength * 0.5) {
      sliceIndex = maxLength;
    }

    chunks.push(remaining.slice(0, sliceIndex).trim());
    remaining = remaining.slice(sliceIndex).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.filter(Boolean);
}

export function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractUrls(text) {
  return Array.from(text.matchAll(/https?:\/\/[^\s]+/gi), (match) => match[0]);
}

export function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function toDataUri(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
