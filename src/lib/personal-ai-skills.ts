import catalog from '../../public/one/ai-skills.json';
import {MarketError} from '@/lib/security';

export function personalAISkill(selection:unknown, mode:string) {
  const selected=selection===undefined||selection==='auto'
    ? catalog.auto.mode[mode as keyof typeof catalog.auto.mode]
    : selection;
  if(selected===undefined||selected==='none')return null;
  if(typeof selected!=='string'||!Object.hasOwn(catalog.skills,selected)){
    throw new MarketError('사용할 프리셋을 다시 선택해 주세요.');
  }
  return catalog.skills[selected as keyof typeof catalog.skills];
}
