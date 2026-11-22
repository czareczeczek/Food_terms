import { useEffect, useRef, useState } from 'react'
import type { Nutrition } from '../core/model'
import { lookupFood, normalizeBarcode, type FoodFactsProduct } from '../services/foodFacts'

interface NutritionFieldsProps {
  barcode: string
  nutrition: Nutrition | undefined
  onBarcodeChange: (barcode: string) => void
  onNutritionChange: (nutrition: Nutrition | undefined) => void
  onName: (name: string) => void
}

type Nutrient = 'kcal' | 'protein' | 'fat' | 'carbs'
const fields: { key: Nutrient; label: string }[] = [
  { key: 'kcal', label: 'Energia (kcal)' },
  { key: 'protein', label: 'Białko (g)' },
  { key: 'fat', label: 'Tłuszcz (g)' },
  { key: 'carbs', label: 'Węglowodany (g)' },
]

function blankNutrition(): Nutrition {
  return { basis: '100g', kcal: null, protein: null, fat: null, carbs: null, source: 'manual' }
}

function Source({ nutrition }: { nutrition: Nutrition | undefined }) {
  return <p className="nutrition-source">
    {nutrition?.sourceBarcode
      ? <><span>{nutrition.source === 'manual' ? 'Pierwotne dane: ' : 'Źródło: '}</span><a href={`https://world.openfoodfacts.org/product/${nutrition.sourceBarcode}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open Food Facts</a></>
      : <>Źródło: wartości wpisane ręcznie. <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open Food Facts</a></>}
    {' · '}<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">licencja ODbL</a>
  </p>
}

export function NutritionFields({ barcode, nutrition, onBarcodeChange, onNutritionChange, onName }: NutritionFieldsProps) {
  const [preview, setPreview] = useState<FoodFactsProduct | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [loading, setLoading] = useState(false)
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    request.current?.abort()
    setPreview(null)
    setMessage('')
    setLoading(false)
    return () => {
      generation.current += 1
      request.current?.abort()
    }
  }, [barcode])

  async function search() {
    request.current?.abort()
    const current = ++generation.current
    const controller = new AbortController()
    request.current = controller
    setPreview(null)
    setMessage('')
    setIsError(false)
    setLoading(true)
    try {
      const result = await lookupFood(barcode, controller.signal)
      if (current !== generation.current || controller.signal.aborted) return
      if (!result) {
        setIsError(true)
        setMessage('Nie znaleziono produktu. Wpisz nazwę i wartości odżywcze ręcznie.')
      } else {
        setPreview(result)
      }
    } catch (error) {
      if (current !== generation.current || controller.signal.aborted) return
      setIsError(true)
      setMessage(error instanceof Error ? error.message : 'Nie udało się pobrać produktu. Wpisz dane ręcznie.')
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }

  function apply() {
    if (!preview) return
    try {
      if (normalizeBarcode(barcode) !== preview.barcode) return
    } catch {
      return
    }
    if (preview.name) onName(preview.name)
    if (preview.nutrition) onNutritionChange({ ...preview.nutrition })
    setPreview(null)
    setIsError(false)
    setMessage('Dane zastosowane. Możesz je poprawić przed zapisaniem produktu.')
  }

  function changeValue(key: Nutrient, raw: string) {
    const value = raw === '' ? null : Number(raw)
    if (value !== null && !Number.isFinite(value)) return
    onNutritionChange({ ...(nutrition ?? blankNutrition()), [key]: value === null ? null : Math.round(value * 1_000_000) / 1_000_000, source: 'manual' })
  }

  function changeBasis(basis: Nutrition['basis']) {
    onNutritionChange({ ...(nutrition ?? blankNutrition()), basis, source: 'manual' })
  }

  return <section className="nutrition-fields" aria-labelledby="nutrition-fields-title">
    <h3 id="nutrition-fields-title">Wartości odżywcze <span className="optional">(opcjonalnie)</span></h3>
    <div className="nutrition-lookup">
      <label className="field">Kod kreskowy
        <input value={barcode} onChange={event => onBarcodeChange(event.target.value)} inputMode="numeric" autoComplete="off" placeholder="8–14 cyfr" maxLength={32} onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            void search()
          }
        }} />
      </label>
      <button type="button" className="btn secondary" onClick={() => void search()} disabled={loading}>{loading ? 'Pobieranie…' : 'Pobierz z Open Food Facts'}</button>
    </div>
    <p className="help">Po wybraniu przycisku wysyłamy do Open Food Facts tylko kod kreskowy. Twoja lista produktów pozostaje prywatna.</p>
    {message && <p role={isError ? 'alert' : 'status'} className={isError ? 'alert error' : 'help'}>{message}</p>}
    {preview && <div className="nutrition-preview" role="region" aria-label="Podgląd danych Open Food Facts">
      <h4>Podgląd danych Open Food Facts</h4>
      <p><strong>{preview.name || 'Produkt bez nazwy'}</strong>{preview.brand && <> · {preview.brand}</>}</p>
      {preview.nutrition && <><p>Na {preview.nutrition.basis === '100g' ? '100 g' : '100 ml'}</p><dl className="nutrition-grid">{fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{preview.nutrition?.[field.key] ?? '—'}</dd></div>)}</dl></>}
      {preview.warning && <p className="help">{preview.warning}</p>}
      <button type="button" className="btn secondary" onClick={apply}>Zastosuj dane</button>
      <Source nutrition={preview.nutrition ?? { ...blankNutrition(), source: 'openfoodfacts', sourceBarcode: preview.barcode }} />
    </div>}
    <label className="field">Wartości dla
      <select value={nutrition?.basis ?? '100g'} onChange={event => changeBasis(event.target.value as Nutrition['basis'])}>
        <option value="100g">100 g</option>
        <option value="100ml">100 ml</option>
      </select>
    </label>
    <p className="help">Wpisz wartości z etykiety. Puste pole oznacza brak danych, a 0 oznacza zero. Zmiana podstawy nie przelicza wartości.</p>
    <div className="nutrition-grid">{fields.map(field => <label className="field" key={field.key}>{field.label}
      <input type="number" min="0" max={field.key === 'kcal' || nutrition?.basis === '100ml' ? 1000 : 100} step="any" value={nutrition?.[field.key] ?? ''} onChange={event => changeValue(field.key, event.target.value)} />
    </label>)}</div>
    <Source nutrition={nutrition} />
  </section>
}

export default NutritionFields
