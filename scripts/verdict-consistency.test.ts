import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { determineVerdict, VERDICT_LABELS } from '../lib/scoring/verdict';
import { resolveProductVerdict } from '../lib/scoring/verdict-resolve';
import { catalogTierStyle, VERDICT_COLORS } from '../lib/scoring/verdict-display';
import { gridItemToCard } from '../lib/products/card';
import { executePlan } from '../lib/search/planned/execute';
import { toCard } from '../lib/search/planned/present';
import { degradedPlan } from '../lib/search/planned/search';
import { VerdictTakeCard } from '../components/verdict-take-card';
import type { CatalogGridItem } from '../lib/products/queries';
import type { Sql } from '../lib/search/planned/db';

test('one deterministic verdict respects boundaries, product role and concern overrides', () => {
  for (const [absolute, expected] of [[39,'skip'],[40,'occasional_treat'],[64,'occasional_treat'],[65,'good_choice'],[79,'good_choice'],[80,'daily_staple']] as const)
    assert.equal(determineVerdict({absolute,role_cohort:'staple'}),expected);
  assert.equal(determineVerdict({absolute:88,role_cohort:'treat'}),'occasional_treat');
  assert.equal(determineVerdict({absolute:49,role_cohort:'staple',hazardous:true}),'skip');
});
test('unscored or non-finite products cannot retain a stale verdict', () => {
  for (const score of [null,undefined,NaN,Infinity]) assert.equal(resolveProductVerdict({verdict:'skip',score}),null);
  assert.equal(resolveProductVerdict({verdict:'skip',score:49}),'skip');
  assert.equal(resolveProductVerdict({verdict:'legacy',score:39}),'skip');
});
test('search and catalog preserve the same stored concern verdict and absolute score', async () => {
  const plan={...degradedPlan('flour'),sort:{field:'scout_score' as const,dir:'desc' as const}};
  const sql={unsafe:async (query:string)=>{
    assert.match(query,/left join core_scores cs/);
    assert.match(query,/cs\.verdict as scout_verdict/);
    assert.doesNotMatch(query,/coalesce\(si\.absolute_score/);
    return [{id:'p',slug:'p',name:'Quinoa flour',category:'Flour',subcategory:'Flour',scout_score:49,scout_verdict:'skip',absolute_score:49,nutrition:{},f_id:'p',ingredients:[],claims:[],present:[],may_contain:[],unknown:[],conflicts:[],image_urls:[],ingredient_status:'complete',nutrition_ok:true,relevance:1}];
  }} as unknown as Sql;
  const result=await executePlan(sql,plan,null,{noRelax:true});
  const search=toCard(result.items[0],plan);
  const grid=gridItemToCard({id:'p',slug:'p',name:'Quinoa flour',category:'Flour',subcategory:'Flour',image_urls:[],core_scores:{score:60,absolute_score:49,verdict:'skip'}} as unknown as CatalogGridItem);
  assert.equal(search.verdict,'skip'); assert.equal(grid.verdict,search.verdict);
  assert.equal(search.score,49); assert.equal(grid.score,49);
  assert.equal(catalogTierStyle(49,search.verdict).fill,VERDICT_COLORS.skip.fg);
});
test('PDP hero uses the same verdict, never a competing numeric health tier', () => {
  for(const verdict of ['daily_staple','good_choice','occasional_treat','skip'] as const){
    const html=renderToStaticMarkup(createElement(VerdictTakeCard,{verdict,score:70,absoluteScore:65}));
    assert.ok(html.includes(VERDICT_LABELS[verdict].title));
    assert.ok(html.includes(VERDICT_COLORS[verdict].fg));
    assert.doesNotMatch(html,/>Excellent<|>Fair<|Grade [A-F]/);
  }
});
test('unknown verdicts use neutral presentation rather than another grading system', () => {
  assert.equal(catalogTierStyle(90,null).fill,'var(--color-fg-dim)');
});

test('explanation cannot recommend a regular buy for a stored skip verdict', async () => {
  const { explainScore } = await import('../lib/products/score-explain');
  const result=explainScore({score:49,verdict:'skip',nutrition:null,ingredients_raw:null,productName:'Flour'});
  assert.deepEqual(result.tradeoffs,[VERDICT_LABELS.skip.description]);
  assert.doesNotMatch(result.tradeoffs.join(' '),/regular buy|fine once|occasional treat/i);
});

test('hero facts do not append a competing frequency recommendation', () => {
  const html=renderToStaticMarkup(createElement(VerdictTakeCard,{verdict:'daily_staple',score:82,explanation:{reasons:['Moderate fat'],tradeoffs:[]}}));
  assert.ok(html.includes('Daily staple'));
  assert.ok(html.includes('Moderate fat'));
  assert.doesNotMatch(html,/fine occasionally, not daily/);
});
