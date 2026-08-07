import { el, setMeta, tickIcon } from '../ui.js';
import { api } from '../api.js';
import { loadingBlock, errorBlock, sectionHeader } from '../components.js';

export function renderVerification() {
  setMeta(
    'What AETERNA Verified covers',
    'The published scope of the AETERNA Verified checks: identity, insurance, references, portfolio rights, video call and annual re-checks.'
  );

  const host = el('div', {}, [loadingBlock('Loading the verification scope')]);

  (async () => {
    let scope;
    try { scope = await api.verificationScope(); }
    catch (error) { host.replaceChildren(errorBlock(error.message)); return; }

    host.replaceChildren(
      el('section', { class: 'section section--tight section--sage' }, [
        el('div', { class: 'wrap-narrow' }, [
          sectionHeader({
            eyebrow: `Version ${scope.version}, effective ${scope.effective}`,
            title: scope.headline,
            lede: scope.intro,
            accent: 'sage',
          }),
        ]),
      ]),
      el('section', { class: 'section' }, [
        el('div', { class: 'wrap-narrow' }, [
          el('h2', { style: 'margin-bottom:22px' }, 'The checks'),
          ...scope.checks.map((check, index) => el('div', { class: 'panel', style: 'margin-bottom:14px' }, [
            el('div', { style: 'display:flex;gap:14px;align-items:flex-start' }, [
              el('div', {
                style: 'width:34px;height:34px;flex:none;border-radius:50%;background:var(--sage-wash);color:var(--sage-ink);display:grid;place-items:center;font-weight:700;font-size:.9rem',
                'aria-hidden': 'true',
              }, String(index + 1)),
              el('div', {}, [
                el('h3', { style: 'font-size:1.15rem;margin-bottom:6px' }, check.title),
                el('p', { class: 'muted', style: 'margin:0' }, check.detail),
              ]),
            ]),
          ])),

          el('h2', { style: 'margin:40px 0 18px' }, 'What it does not cover'),
          el('div', { class: 'panel panel--blush' }, [
            el('ul', { class: 'crosslist', style: 'margin:0' }, scope.limits.map((limit) => el('li', {}, [
              el('span', { 'aria-hidden': 'true', style: 'color:var(--coral-deep);font-weight:700' }, '×'),
              el('span', {}, limit),
            ]))),
          ]),

          el('div', { class: 'notice notice--info', style: 'margin-top:24px' }, [
            el('div', {}, 'We describe this as a completed set of checks. We do not describe it as personal vetting, because that would imply a judgement we have not made.'),
          ]),
        ]),
      ])
    );
  })();

  return host;
}

export function renderFairUse() {
  setMeta(
    'AI planner fair use policy, AETERNA',
    'Published monthly message allowances for the AETERNA AI wedding planner. Generous, but not unlimited.'
  );

  const host = el('div', {}, [loadingBlock('Loading the fair use policy')]);

  (async () => {
    let policy;
    try { policy = await api.fairUse(); }
    catch (error) { host.replaceChildren(errorBlock(error.message)); return; }

    host.replaceChildren(
      el('section', { class: 'section section--tight section--blush' }, [
        el('div', { class: 'wrap-narrow' }, [
          sectionHeader({
            eyebrow: `Version ${policy.version}, effective ${policy.effective}`,
            title: policy.headline,
            lede: policy.intro,
          }),
        ]),
      ]),
      el('section', { class: 'section' }, [
        el('div', { class: 'wrap-narrow' }, [
          el('div', { class: 'panel', style: 'margin-bottom:24px' }, [
            el('div', { class: 'table-scroll' }, [
              el('table', { class: 'table' }, [
                el('thead', {}, [el('tr', {}, [el('th', {}, 'Who'), el('th', {}, 'Allowance')])]),
                el('tbody', {}, policy.limits.map((limit) => el('tr', {}, [
                  el('td', {}, el('strong', {}, limit.label)),
                  el('td', {}, limit.value),
                ]))),
              ]),
            ]),
          ]),
          el('div', { class: 'panel panel--sage', style: 'margin-bottom:14px' }, [
            el('h3', { style: 'font-size:1.15rem' }, 'If you reach a limit'),
            el('p', { style: 'margin:0' }, policy.overage),
          ]),
          el('div', { class: 'panel' }, [
            el('h3', { style: 'font-size:1.15rem' }, 'Automated use'),
            el('p', { class: 'muted', style: 'margin:0' }, policy.abuse),
          ]),
          el('div', { class: 'notice notice--info', style: 'margin-top:24px' }, [
            el('div', {}, 'We publish the numbers rather than describing the planner as unlimited, because a published number is something you can hold us to.'),
          ]),
        ]),
      ])
    );
  })();

  return host;
}
