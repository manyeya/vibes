(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const stages = ['Understand', 'Delegate', 'Implement', 'Review'];
  const tasks = {
    theme: [
      ['REPOSITORY CONTEXT', 'AGENTS.md', '# Project guidance\nUse the existing design tokens.\nKeep the user’s theme preference.\nRespect the system color scheme.\n\n→ Inspect theme.css and settings.ts', 'First, read the project guidance and find the files that matter.', 'Context before code.'],
      ['WORK ASSIGNMENT', 'task / delegate', 'Vibes → Builder\nAdd theme tokens and a persistent toggle.\n\nVibes → Reviewer\nCheck contrast and first-load behavior.\n\n↳ Results return to the main conversation.', 'Give each specialist a focused task. Keep the shared direction with the main agent.', 'A focused brief for each worker.'],
      ['PROPOSED CHANGE', 'src/theme.css', '  :root {\n    --surface: #f5f5ef;\n    --text: #171914;\n  }\n+ [data-theme="dark"] {\n+   --surface: #171914;\n+   --text: #f5f5ef;\n+ }', 'The builder edits the relevant files. The change stays visible as a diff.', 'Changes you can inspect.'],
      ['REVIEW NOTES', 'review / findings', '✓ Theme preference persists after reload.\n✓ Both themes use shared design tokens.\n\n! Check theme before the first paint\n  to avoid a flash of the wrong colors.\n\n→ Bring this finding back to the builder.', 'An independent review catches a first-paint issue. Vibes brings the finding back into the work.', 'Review is a feedback loop, not a rubber stamp.']
    ],
    bug: [
      ['FAILURE CONTEXT', 'checkout.test.ts', 'FAIL checkout / empty cart\nExpected: "Your cart is empty"\nReceived: "Order placed"\n\n→ Read the failing assertion.\n→ Trace the checkout handler.', 'Start from the failure and trace the behavior before choosing a fix.', 'Reproduce. Then reason.'],
      ['WORK ASSIGNMENT', 'task / delegate', 'Vibes → Builder\nFind and fix the empty-cart path.\n\nVibes → Reviewer\nCheck the guard and regression coverage.\n\n↳ Keep the change focused on the failure.', 'Separate the implementation from an independent check of the same behavior.', 'Small scope. Clear ownership.'],
      ['PROPOSED CHANGE', 'src/checkout.ts', '  async function checkout(cart) {\n+   if (cart.items.length === 0) {\n+     return { error: "Your cart is empty" };\n+   }\n    return placeOrder(cart);\n  }\n\n# Add coverage for the empty-cart path.', 'Add the missing guard and a regression test for the behavior that failed.', 'A fix with a reason to stay fixed.'],
      ['REVIEW NOTES', 'review / findings', '✓ Empty carts stop before placeOrder.\n✓ Existing checkout path is unchanged.\n\n! Also check cart loading failures.\n  An unavailable cart is not an empty cart.\n\n→ Confirm the boundary before wrapping up.', 'The reviewer checks neighboring failure paths and reports what still needs attention.', 'The result includes the open questions.']
    ],
    map: [
      ['REPOSITORY CONTEXT', 'repository / files', 'apps/\n  api/         HTTP entry point\n  tui/         Terminal interface\npackages/\n  harness/     Agent runtime\n\n→ Read README.md and project guidance.', 'Build an initial map from the repository itself, starting with its guidance.', 'Understand the shape of the project.'],
      ['WORK ASSIGNMENT', 'task / delegate', 'Vibes → Explorer\nTrace the request lifecycle in apps/api.\n\nVibes → Reviewer\nVerify the module boundaries.\n\n↳ Read-only exploration; no file changes.', 'Give the explorer a specific path to trace, with an independent architecture check.', 'Focused exploration.'],
      ['ARCHITECTURE NOTES', 'request / lifecycle', 'User input\n  → HTTP streaming endpoint\n  → Session runtime\n  → Agent loop\n  → Model step / tool execution\n  → Streamed result\n\n# Interfaces share the same core runtime.', 'Collect the findings into a readable path from input to result.', 'Make the architecture easier to navigate.'],
      ['REVIEW NOTES', 'review / findings', '✓ API routes are transport boundaries.\n✓ Session runtime owns agent state.\n✓ Tool execution belongs to the harness.\n\n→ Start with the runtime for agent changes.\n→ Start with the routes for transport work.', 'Cross-check the map and turn it into useful starting points for the next task.', 'A map you can actually work from.']
    ]
  };
  const select = document.getElementById('task-select');
  const play = document.getElementById('session-play');
  const buttons = [...document.querySelectorAll('[data-stage]')];
  let stage = 0, playing = false, timer;
  function stop() {
    playing = false; clearTimeout(timer);
    play.querySelector('[data-play-label]').textContent = stage === 3 ? 'Replay walkthrough' : 'Run walkthrough';
    play.firstElementChild.textContent = stage === 3 ? '↻' : '▶';
  }
  function render(next, announce = true) {
    stage = next;
    const [label, file, content, explanation, summary] = tasks[select.value][stage];
    document.getElementById('output-label').textContent = `0${stage + 1} / ${label}`;
    document.getElementById('output-file').textContent = file;
    document.getElementById('run-explanation').textContent = explanation;
    document.getElementById('output-summary').textContent = summary;
    document.getElementById('run-counter').textContent = `0${stage + 1} / 04`;
    const code = document.getElementById('run-code');
    code.replaceChildren(...content.split('\n').map(line => {
      const span = document.createElement('span');
      span.className = 'v-code-line' + (line.startsWith('+') ? ' add' : line.startsWith('!') ? ' remove' : line.startsWith('#') ? ' comment' : '');
      span.textContent = line || ' '; return span;
    }));
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === stage)));
    document.querySelectorAll('[data-agent]').forEach((agent, i) => {
      const states = [['reading', 'standby', 'standby'], ['coordinating', 'assigned', 'assigned'], ['coordinating', select.value === 'map' ? 'exploring' : 'building', 'standby'], ['synthesizing', 'done', 'reviewing']];
      agent.dataset.state = i === 0 || (stage === 2 && i === 1) || (stage === 3 && i === 2) ? 'active' : stage === 3 && i === 1 ? 'done' : 'idle';
      agent.querySelector('.v-agent-status').textContent = states[stage][i];
      if (i === 1) {
        agent.querySelector('strong').textContent = select.value === 'map' ? 'Explorer' : 'Builder';
        agent.querySelector('small').textContent = select.value === 'map' ? 'Focused worker / repository research' : 'Focused worker / implementation';
      }
    });
    buttons[2].childNodes[1].textContent = select.value === 'map' ? 'Explore' : 'Implement';
    if (announce) document.getElementById('run-live').textContent = `${stages[stage]}: ${summary}`;
  }
  function schedule() {
    timer = setTimeout(() => { if (stage < 3) { render(stage + 1); if (stage < 3) schedule(); else stop(); } }, 2600);
  }
  play.addEventListener('click', () => {
    if (playing) { stop(); return; }
    if (stage === 3) render(0);
    playing = true; play.firstElementChild.textContent = 'Ⅱ'; play.querySelector('[data-play-label]').textContent = 'Pause walkthrough'; schedule();
  });
  buttons.forEach((button, i) => button.addEventListener('click', () => { stop(); render(i); stop(); }));
  select.addEventListener('change', () => { stop(); render(0); stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  render(0, false);
  const modes = {
    plan: ['Think it through.', 'Explore the repository and put a plan together before changing anything.', 'Read-only', 'Read-only policy'],
    manual: ['Keep a hand on it.', 'Review each proposed edit and command before allowing the agent to act.', 'Your approval', 'Your approval'],
    'auto-edit': ['Let the edits flow.', 'Let Vibes change files while you approve shell commands and delegation.', 'Automatic', 'Your approval'],
    auto: ['Give it room to work.', 'Allow edits, commands, and delegation automatically for a task with a clear scope.', 'Automatic', 'Automatic']
  };
  document.querySelectorAll('[data-mode]').forEach((button, i) => button.addEventListener('click', () => {
    const value = modes[button.dataset.mode];
    ['mode-title', 'mode-description', 'mode-files', 'mode-shell'].forEach((id, j) => document.getElementById(id).textContent = value[j]);
    document.getElementById('mode-number').textContent = `0${i + 1} — 04`;
    document.querySelectorAll('[data-mode]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  }));
  // A procedural signal sculpture: strands join into one moving form.
  const canvas = document.getElementById('signal-canvas'), context = canvas.getContext('2d');
  if (!context) return;
  let paused = false;
  const motionButton = document.getElementById('motion-toggle');
  motionButton.hidden = reduced.matches;
  motionButton.addEventListener('click', () => { paused = !paused; document.body.classList.toggle('motion-paused', paused); motionButton.setAttribute('aria-pressed', String(paused)); motionButton.textContent = paused ? 'Resume motion ▶' : 'Pause motion Ⅱ'; if (paused) { cancelAnimationFrame(raf); raf = 0; } else resume(); });
  let width = 0, height = 0, angle = 0, targetX = 0, targetY = 0, tiltX = 0, tiltY = 0, raf = 0, visible = true, last = 0;
  function size() {
    const box = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
    width = box.width; height = box.height; canvas.width = width * ratio; canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0); draw(0);
  }
  function draw(time) {
    const delta = last ? Math.min(time - last, 40) : 16; last = time;
    if (!reduced.matches) angle += delta * .00012;
    tiltX += (targetX - tiltX) * .045; tiltY += (targetY - tiltY) * .045;
    context.clearRect(0, 0, width, height);
    const radius = Math.min(width * .32, height * .39);
    for (let strand = 0; strand < 34; strand++) {
      const phi = strand / 34 * Math.PI * 2;
      context.beginPath();
      for (let step = 0; step <= 120; step++) {
        const t = step / 120 * Math.PI * 2;
        const ring = radius * (.79 + .23 * Math.cos(3 * t + phi));
        let x = ring * Math.cos(t), y = ring * Math.sin(t), z = radius * .36 * Math.sin(3 * t + phi);
        const rot = angle + tiltX, xx = x * Math.cos(rot) + z * Math.sin(rot), zz = -x * Math.sin(rot) + z * Math.cos(rot);
        const yy = y * Math.cos(.65 + tiltY) - zz * Math.sin(.65 + tiltY);
        const depth = y * Math.sin(.65 + tiltY) + zz * Math.cos(.65 + tiltY);
        const perspective = 650 / (650 + depth);
        const px = width * .5 + xx * perspective, py = height * .51 + yy * perspective;
        if (step === 0) context.moveTo(px, py); else context.lineTo(px, py);
      }
      context.strokeStyle = '#151613'; context.globalAlpha = .23 + .5 * ((Math.sin(phi + angle) + 1) / 2); context.lineWidth = .65; context.stroke();
    }
    context.globalAlpha = 1;
  }
  function tick(time) { raf = 0; draw(time); if (visible && !document.hidden && !reduced.matches && !paused) raf = requestAnimationFrame(tick); }
  function resume() { if (!raf && visible && !document.hidden && !reduced.matches && !paused) { last = 0; raf = requestAnimationFrame(tick); } }
  canvas.addEventListener('pointermove', event => { if (reduced.matches || event.pointerType === 'touch') return; const box = canvas.getBoundingClientRect(); targetX = (event.clientX - box.left - width / 2) / width * .7; targetY = (event.clientY - box.top - height / 2) / height * .6; });
  canvas.addEventListener('pointerleave', () => { targetX = 0; targetY = 0; });
  new ResizeObserver(size).observe(canvas);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (!visible) { cancelAnimationFrame(raf); raf = 0; } else resume(); }).observe(canvas);
  reduced.addEventListener('change', () => { motionButton.hidden = reduced.matches; cancelAnimationFrame(raf); raf = 0; if (reduced.matches) draw(0); else resume(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else resume(); });
  size(); resume();
})();
