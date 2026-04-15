export function parseFrontmatter(markdown) {
  const text = String(markdown ?? '');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return { attributes: {}, body: text };
  }

  const lines = text.split(/\r?\n/);
  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      endIndex = index;
      break;
    }
  }

  if (endIndex === -1) {
    return { attributes: {}, body: text };
  }

  const attributes = {};
  for (const line of lines.slice(1, endIndex)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    attributes[key] = value;
  }

  return {
    attributes,
    body: lines.slice(endIndex + 1).join('\n'),
  };
}

function findFirstHeading(markdownBody) {
  const match = String(markdownBody ?? '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function stripMarkdownNoise(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findFirstParagraph(markdownBody) {
  const paragraphs = String(markdownBody ?? '')
    .split(/\n\s*\n/g)
    .map((paragraph) => stripMarkdownNoise(paragraph))
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    if (/^[A-Z][A-Za-z0-9\-\s]{1,120}$/.test(paragraph) && paragraph.split(' ').length <= 10) {
      continue;
    }
    return paragraph;
  }

  return null;
}

export function extractSkillMetadata(files) {
  const normalizedFiles = Array.isArray(files) ? files : [];
  const skillFile = normalizedFiles
    .filter((file) => file && typeof file.path === 'string' && file.path.endsWith('SKILL.md'))
    .sort((a, b) => a.path.length - b.path.length)[0];

  if (!skillFile) {
    return {
      skillFilePath: null,
      instructions: null,
      name: null,
      description: null,
    };
  }

  const instructions = String(skillFile.contents ?? '');
  const { attributes, body } = parseFrontmatter(instructions);
  const heading = findFirstHeading(body);
  const description =
    (typeof attributes.description === 'string' && attributes.description.trim()) ||
    findFirstParagraph(body) ||
    null;

  return {
    skillFilePath: skillFile.path,
    instructions,
    name: (typeof attributes.name === 'string' && attributes.name.trim()) || heading || null,
    description,
  };
}
