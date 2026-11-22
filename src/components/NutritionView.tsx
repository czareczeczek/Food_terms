import type { Nutrition, Product } from '../core/model'
import { nutritionFactor } from '../core/model'

const nutrients: { key: 'kcal' | 'protein' | 'fat' | 'carbs'; label: string; unit: string }[] = [
  { key: 'kcal', label: 'Energia', unit: 'kcal' },
  { key: 'protein', label: 'Białko', unit: 'g' },
  { key: 'fat', label: 'Tłuszcz', unit: 'g' },
  { key: 'carbs', label: 'Węglowodany', unit: 'g' },
]

function formatValue(value: number | null, unit: string): string {
  if (value === null) return '—'
  if (value > 0 && value < 0.000001) return `<0,000001 ${unit}`
  return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 6 }).format(value)} ${unit}`
}

function Values({ nutrition, factor = 1 }: { nutrition: Nutrition; factor?: number }) {
  return <dl className="nutrition-grid">{nutrients.map(nutrient => <div key={nutrient.key}>
    <dt>{nutrient.label}</dt>
    <dd>{formatValue(nutrition[nutrient.key] === null ? null : nutrition[nutrient.key]! * factor, nutrient.unit)}</dd>
  </div>)}</dl>
}

export function NutritionView({ product }: { product: Product }) {
  const nutrition = product.nutrition
  if (!nutrition) return null
  const factor = nutritionFactor(product.quantity, product.unit, nutrition.basis)

  return <section className="nutrition-view" aria-label={`Wartości odżywcze: ${product.name}`}>
    <h4>Wartości odżywcze</h4>
    <p>Na {nutrition.basis === '100g' ? '100 g' : '100 ml'}</p>
    <Values nutrition={nutrition} />
    {factor !== null && <div className="nutrition-totals">
      <h5>Dla zapisanej ilości</h5>
      <Values nutrition={nutrition} factor={factor} />
    </div>}
    {factor === null && <p className="help">Przeliczenie wymaga ilości w {nutrition.basis === '100g' ? 'g lub kg' : 'ml lub l'}.</p>}
    <p className="nutrition-source">
      {nutrition.source === 'manual' ? 'Wartości wpisane ręcznie.' : 'Źródło: '}
      {nutrition.sourceBarcode && <>{nutrition.source === 'manual' ? ' Pierwotne dane: ' : ''}<a href={`https://world.openfoodfacts.org/product/${nutrition.sourceBarcode}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open Food Facts</a>{' · '}<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">ODbL</a></>}
    </p>
  </section>
}

export default NutritionView
