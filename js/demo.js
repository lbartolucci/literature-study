/* =========================================================================
   demo.js — optional sample data, so the app can be explored before any real
   paper is added. Everything here is clearly marked "(demo)" and carries no
   DOI: it is illustrative UI content, not real bibliographic data. Remove it
   any time from Settings.
   ========================================================================= */

import * as store from './store.js';
import { newPaper } from './models.js';

const DEMO_TAG = { demo: true };

export async function loadDemo () {
  const onori = await store.ensureAuthor({ name: 'Simona Onori', affiliation: 'Stanford University' });
  const group = await store.ensureGroup({ name: 'Onori Lab (demo)', institution: 'Stanford University', lead: 'Simona Onori' });

  const seeds = [
    { area: 'batteries', title: '(demo) State-of-health estimation for lithium-ion cells with an ESPM–UKF observer',
      authors: ['Simona Onori', 'A. Researcher'], authorRefs: [onori.id], groupRefs: [group.id], year: 2023,
      venue: 'Journal of Power Sources (demo)',
      abstract: 'A demonstration record. It shows how an abstract, keywords and concepts appear in the reader. Replace it by adding a real paper via DOI or title, which pulls verified metadata from OpenAlex.',
      keywords: ['state of health', 'Kalman filter', 'electrochemical model'],
      concepts: [{ id: 'demo1', name: 'Battery management system', score: 0.8 }],
      notes: 'Example note: strong benchmark for joint SoC/SoH estimation. Use as a reference point.',
      takeaways: ['ESPM + UKF gives sub-2% SoH error on population tuning', 'Per-cell OCV calibration matters more than filter tuning'] },
    { area: 'batteries', title: '(demo) Reduced testing protocols via reinforcement learning',
      authors: ['B. Author'], year: 2024, venue: 'IEEE T-CST (demo)',
      abstract: 'Another demonstration record used to show links and quizzes.',
      keywords: ['reinforcement learning', 'design of experiments', 'ECM'],
      notes: 'Example note: TD3 designs a ~14x shorter test that still calibrates the ECM maps.',
      takeaways: ['Fast/ohmic branches replicate well; diffusive branch still open'] },
    { area: 'hydrogen', title: '(demo) Techno-economic analysis of green hydrogen production',
      authors: ['C. Example'], year: 2022, venue: 'Int. J. Hydrogen Energy (demo)',
      abstract: 'Demo abstract for the Hydrogen area.',
      keywords: ['electrolysis', 'levelized cost', 'renewables'],
      takeaways: ['LCOH is dominated by electricity price and capacity factor'] }
  ];

  for (const s of seeds) {
    const p = Object.assign(newPaper(s.area), s, DEMO_TAG);
    await store.savePaper(p);
  }
  return seeds.length;
}

export async function removeDemo () {
  const demoPapers = store.state.papers.filter(p => p.demo);
  for (const p of demoPapers) await store.deletePaper(p.id);
  const g = store.state.groups.find(x => x.name === 'Onori Lab (demo)');
  if (g) await store.deleteGroup(g.id);
  return demoPapers.length;
}

export const hasDemo = () => store.state.papers.some(p => p.demo);
