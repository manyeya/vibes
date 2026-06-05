import { core } from './sections/core';
import { role } from './sections/role';
import { synthesis } from './sections/synthesis';

export const vibePrompt = [
    core,
    role,
    synthesis
].join('\\n\\n');

export default vibePrompt;
