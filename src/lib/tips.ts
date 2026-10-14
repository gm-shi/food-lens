import type { Lang } from '../i18n';
import type { Trimester } from './targets';

/** One calm line per trimester, drawn from Eat for Health / NSW Health pregnancy guidance. */
export const TIPS: Record<Lang, Record<Trimester, string>> = {
  zh: {
    1: '孕早期重点是叶酸和碘：通常会建议补充叶酸和碘，具体听医生或助产士的；多吃绿叶菜、豆类和全谷物。恶心时少量多餐。',
    2: '孕中期重点是铁和钙：瘦红肉、豆类配维生素C食物帮助吸铁；每天两到三份奶制品或钙强化豆奶。',
    3: '孕晚期重点是铁、钙和 omega-3：每周两三份低汞鱼（三文鱼、沙丁鱼），多吃蔬果全谷物保证纤维。',
  },
  en: {
    1: 'First trimester: folate and iodine come first. Folic acid and iodine supplements are usually recommended; ask your doctor or midwife. Leafy greens, legumes and wholegrains help too, and small frequent meals ease nausea.',
    2: 'Second trimester: iron and calcium. Lean red meat or legumes with a vitamin C food helps iron absorb; two to three serves of dairy or calcium-fortified soy a day.',
    3: 'Third trimester: iron, calcium and omega-3. Two or three serves a week of low-mercury fish such as salmon or sardines, with plenty of vegetables, fruit and wholegrains for fibre.',
  },
};
