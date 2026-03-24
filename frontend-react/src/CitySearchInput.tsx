import { useEffect, useState } from 'react';
import { requestApi } from './api';
import type { CityOption } from './types';

interface CitySearchInputProps {
  selectedLabel?: string;
  onSelect: (city: CityOption) => void | Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

export function CitySearchInput({
  selectedLabel,
  onSelect,
  placeholder = 'Buscar cidade no Brasil',
  disabled = false,
}: CitySearchInputProps) {
  const [query, setQuery] = useState(selectedLabel || '');
  const [results, setResults] = useState<CityOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || disabled) {
      return;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      setError('');

      requestApi<CityOption[]>(`/weather/cities?q=${encodeURIComponent(trimmedQuery)}`)
        .then((response) => {
          setResults(response);
          if (response.length === 0) {
            setError('Nenhuma cidade encontrada.');
          }
        })
        .catch((requestError) => {
          console.error(requestError);
          setResults([]);
          setError('Nao foi possivel buscar cidades agora.');
        })
        .finally(() => setLoading(false));
    }, 280);

    return () => clearTimeout(timer);
  }, [disabled, open, query]);

  const showDropdown = open && !disabled && (loading || results.length > 0 || Boolean(error));

  return (
    <div className="relative">
      <div className="field-shell flex items-center gap-3 px-0 py-0">
        <span className="pl-4 text-sm text-brand-muted">BR</span>
        <input
          type="text"
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            const nextQuery = event.target.value;

            setQuery(nextQuery);
            setOpen(true);

            if (nextQuery.trim().length < 2) {
              setResults([]);
              setError('');
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-0 py-3 text-sm text-brand-dark outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
        />
        {loading ? (
          <span className="pr-4 text-xs font-semibold uppercase tracking-[0.18em] text-brand-muted">
            buscando
          </span>
        ) : null}
      </div>

      {showDropdown ? (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-3xl border border-slate-200/90 bg-white/95 shadow-[0_30px_50px_-30px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          {results.length > 0 ? (
            <div className="max-h-72 overflow-y-auto p-2">
              {results.map((city) => (
                <button
                  key={`${city.cityName}-${city.latitude}-${city.longitude}`}
                  type="button"
                  className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition hover:bg-slate-50"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setQuery(city.displayName);
                    setOpen(false);
                    setResults([]);
                    setError('');
                    onSelect(city);
                  }}
                >
                  <div>
                    <p className="text-sm font-semibold text-brand-dark">{city.cityName}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-brand-muted">
                      {city.stateCode || city.stateName || 'Brasil'}
                    </p>
                  </div>
                  <span className="text-xs text-brand-muted">{city.timezone}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-4 text-sm text-brand-muted">{error || 'Continue digitando...'}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
