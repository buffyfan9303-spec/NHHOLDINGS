import {join} from 'node:path';
import sharp, {type OverlayOptions} from 'sharp';
import {MarketError} from './security';
import {type PersonalCard} from './personal-cards';

const width = 1080;
const height = 1350;
const inset = 90;
const textWidth = width - 2 * inset;
const pretendard = join(process.cwd(), 'src/server/fonts/Pretendard-Regular.woff2');
const colors = {
  mint: {page: '#E9F1E8', panel: '#DCEADD', headline: '#142820', body: '#253D31', accent: '#2B5E4A'},
  cobalt: {page: '#EDF1FD', panel: '#DDE6FC', headline: '#14234B', body: '#293B67', accent: '#2E4F9E'},
  ink: {page: '#172229', panel: '#24343B', headline: '#F3F7F4', body: '#E0ECE6', accent: '#B9DFBC'},
};

const escaped = (content: string) => content.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[c]!);

function block(w: number, h: number, color: string) {
  return {create: {width: w, height: h, channels: 4 as const, background: color}};
}

async function letters(content: string, color: string, maximumWidth: number, maximumHeight: number, sizes: number[], bold = false) {
  const text = '<span foreground="' + color + '">' + escaped(content) + '</span>';
  for (const size of sizes) {
    const layer = await sharp({text: {
      text, font: 'Pretendard ' + (bold ? 'Bold ' : '') + size, fontfile: pretendard,
      width: maximumWidth, rgba: true, wrap: 'word-char', spacing: Math.round(size * .28),
    }}).png().toBuffer({resolveWithObject: true});
    if (layer.info.height <= maximumHeight) return layer;
  }
  return sharp({text: {
    text, font: 'Pretendard ' + (bold ? 'Bold ' : '') + sizes.at(-1), fontfile: pretendard,
    width: maximumWidth, height: maximumHeight, rgba: true, wrap: 'word-char',
  }}).png().toBuffer({resolveWithObject: true});
}

export async function renderPersonalCard(card: PersonalCard, index: number, format: 'png' | 'jpeg' = 'png') {
  const slide = card.slides[index];
  if (!slide) throw new MarketError('카드를 찾을 수 없습니다.', 404);
  const color = colors[card.theme];
  const labelText = slide.label || (slide.headline === card.title ? '' : card.title);
  const [label, headline, body, page] = await Promise.all([
    labelText ? letters(labelText, color.accent, textWidth, 86, [34, 30, 26], true) : null,
    letters(slide.headline, color.headline, textWidth, 408, [92, 82, 72, 62], true),
    slide.body ? letters(slide.body, color.body, textWidth - 80, 390, [53, 47, 42, 37]) : null,
    card.slides.length > 1 ? letters((index + 1) + ' / ' + card.slides.length, color.accent, 160, 48, [34], true) : null,
  ]);
  const headlineTop = label ? 155 + label.info.height : body ? 168 : 216;
  const dividerTop = headlineTop + headline.info.height + 58;
  const layers: OverlayOptions[] = [
    {input: block(width, 12, color.accent), top: 0, left: 0},
    {input: headline.data, top: headlineTop, left: inset},
    {input: block(textWidth, 2, color.accent), top: 1190, left: inset},
  ];
  if (label) layers.push({input: label.data, top: 96, left: inset});
  if (body) {
    layers.push(
      {input: block(textWidth, body.info.height + 78, color.panel), top: dividerTop, left: inset},
      {input: body.data, top: dividerTop + 39, left: inset + 40},
    );
  }
  if (page) layers.push({input: page.data, top: 1234, left: width - inset - page.info.width});
  const image = sharp(block(width, height, color.page)).composite(layers);
  return format === 'jpeg' ? image.jpeg({quality: 88, chromaSubsampling: '4:4:4'}).toBuffer() : image.png().toBuffer();
}
