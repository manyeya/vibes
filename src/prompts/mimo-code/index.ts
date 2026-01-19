import { core } from './sections/core';
import { role } from './sections/role';
import { synthesis } from './sections/synthesis';

export const mimoCodePrompt = [
    core,
    role,
    synthesis
].join('\\n\\n');

export default mimoCodePrompt;
