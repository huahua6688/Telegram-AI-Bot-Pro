function removeTagBlock(input, tagName) {
  let output = input;
  let lower = output.toLowerCase();
  const startToken = `<${tagName}`;
  const endToken = `</${tagName}`;

  while (true) {
    const startIndex = lower.indexOf(startToken);
    if (startIndex === -1) break;

    const endStartIndex = lower.indexOf(endToken, startIndex);
    if (endStartIndex === -1) {
      output = `${output.slice(0, startIndex)} ${output.slice(startIndex + startToken.length)}`;
      lower = output.toLowerCase();
      continue;
    }

    const endIndex = output.indexOf('>', endStartIndex);
    output = `${output.slice(0, startIndex)} ${output.slice(endIndex === -1 ? output.length : endIndex + 1)}`;
    lower = output.toLowerCase();
  }

  return output;
}

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
  return removeTagBlock(removeTagBlock(html, 'script'), 'style')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|#160);/gi, ' ')
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
