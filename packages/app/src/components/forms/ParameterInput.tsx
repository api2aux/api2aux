import { useState } from 'react'
import type { Parameter } from '@api2aux/semantic-analysis'

/** Parameter with optional URL-parsing enrichments */
type FormParameter = Parameter & { inferredType?: string; isArray?: boolean }
import { TypeIcon } from './TypeIcon'
import { DateTimePicker } from './DateTimePicker'
import { TagInput } from './TagInput'
import { RangeSlider, shouldUseSlider } from './RangeSlider'
import { EnumCheckboxGroup, shouldUseEnumCheckboxGroup, getEnumOptions } from './EnumCheckboxGroup'

interface ParameterInputProps {
  parameter: FormParameter
  value: string                    // Keep for single values
  arrayValue?: string[]            // New: for array parameters
  onChange: (value: string) => void
  onArrayChange?: (values: string[]) => void  // New: for array parameters
  inferredType?: string // Type from inference
  typeOverride?: string // User's override (from store)
  onTypeOverride?: (type: string) => void // Callback for override
  onClear?: () => void // Callback to clear this field
  validate?: (value: string) => string | null // Optional validation function
}

export function ParameterInput({
  parameter,
  value,
  arrayValue,
  onChange,
  onArrayChange,
  inferredType,
  typeOverride,
  onTypeOverride,
  onClear,
  validate,
}: ParameterInputProps) {
  const { name, required, description, schema } = parameter

  // Validation state
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  // Determine effective type: override > inferred > schema > string
  const effectiveType = typeOverride ?? inferredType ?? undefined

  // Validation handler for blur
  const handleBlur = () => {
    setTouched(true)
    if (validate) {
      const validationError = validate(value)
      setError(validationError)
    } else if (required && !value) {
      setError('This field is required')
    }
  }

  // Modified change handler
  const handleChange = (newValue: string) => {
    onChange(newValue)
    // Clear error when typing (if previously touched)
    if (touched && error) {
      setError(null)
    }
  }

  // Determine input type based on effective type or parameter schema
  const renderInput = () => {
    const baseClasses =
      'w-full px-2.5 py-1.5 border border-input rounded-md focus:ring-2 focus-visible:ring-ring/50 focus:border-transparent'
    const errorClasses = error ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''
    // Build placeholder: prefer example, then default
    const exampleHint = schema.example !== undefined ? `e.g. ${schema.example}` : undefined
    const defaultHint = schema.default !== undefined ? String(schema.default) : undefined
    const placeholder = exampleHint ?? defaultHint

    // 1. Enum array → EnumCheckboxGroup
    // Check if schema has items.enum (for OpenAPI array of enum values)
    if (shouldUseEnumCheckboxGroup(schema as any) && onArrayChange) {
      return (
        <EnumCheckboxGroup
          value={arrayValue ?? []}
          onChange={onArrayChange}
          options={getEnumOptions(schema as any)}
          label={name}
        />
      )
    }

    // 2. Array type → TagInput
    if ((schema.type === 'array' || parameter.isArray) && onArrayChange) {
      return (
        <TagInput
          value={arrayValue ?? []}
          onChange={onArrayChange}
          maxItems={(schema as any).maxItems}
          placeholder={`Add ${name}...`}
        />
      )
    }

    // 3. Numeric with min/max → RangeSlider
    if (shouldUseSlider(schema)) {
      const numValue = value ? parseFloat(value) : schema.minimum ?? 0
      return (
        <RangeSlider
          value={numValue}
          onChange={(v) => onChange(String(v))}
          min={schema.minimum!}
          max={schema.maximum!}
          step={schema.type === 'integer' ? 1 : 0.1}
          label={name}
        />
      )
    }

    // 4. Date format → DateTimePicker (without time)
    if (schema.format === 'date' || effectiveType === 'date') {
      return (
        <DateTimePicker
          value={value}
          onChange={onChange}
          includeTime={false}
          placeholder={`Select ${name}`}
          required={required}
        />
      )
    }

    // 5. DateTime format → DateTimePicker (with time)
    if (schema.format === 'date-time') {
      return (
        <DateTimePicker
          value={value}
          onChange={onChange}
          includeTime={true}
          placeholder={`Select ${name}`}
          required={required}
        />
      )
    }

    // Enum → select dropdown (schema takes precedence)
    if (schema.enum && schema.enum.length > 0) {
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={baseClasses}
          required={required}
        >
          <option value="">-- Select {name} --</option>
          {schema.enum.map((option, idx) => (
            <option key={idx} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      )
    }

    // If we have an effective type from inference/override, use it
    if (effectiveType) {
      switch (effectiveType) {
        case 'boolean':
          return (
            <input
              type="checkbox"
              checked={value === 'true'}
              onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
              className="h-4 w-4 text-primary focus-visible:ring-ring/50 border-input rounded"
            />
          )

        case 'number':
          return (
            <input
              type="number"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={handleBlur}
              min={schema.minimum}
              max={schema.maximum}
              placeholder={placeholder}
              className={`${baseClasses} ${errorClasses}`}
              required={required}
            />
          )

        case 'email':
          return (
            <input
              type="email"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={handleBlur}
              placeholder={placeholder}
              className={`${baseClasses} ${errorClasses}`}
              required={required}
            />
          )

        case 'url':
          return (
            <input
              type="url"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={handleBlur}
              placeholder={placeholder}
              className={`${baseClasses} ${errorClasses}`}
              required={required}
            />
          )

        case 'coordinates':
          return (
            <input
              type="text"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={handleBlur}
              placeholder={placeholder ?? 'lat, lng'}
              className={`${baseClasses} ${errorClasses}`}
              required={required}
            />
          )

        case 'zip':
          return (
            <input
              type="text"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={handleBlur}
              placeholder={placeholder ?? '12345 or 12345-6789'}
              pattern="^\d{5}(-\d{4})?$"
              className={`${baseClasses} ${errorClasses}`}
              required={required}
            />
          )

        case 'string':
        default:
          return (
            <input
              type="text"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={handleBlur}
              placeholder={placeholder}
              maxLength={schema.maxLength}
              className={`${baseClasses} ${errorClasses}`}
              required={required}
            />
          )
      }
    }

    // Fall back to schema-based type detection (backward compatibility)

    // Boolean → checkbox
    if (schema.type === 'boolean') {
      return (
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          className="h-4 w-4 text-primary focus-visible:ring-ring/50 border-input rounded"
        />
      )
    }

    // Number/Integer → number input with min/max
    if (schema.type === 'integer' || schema.type === 'number') {
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          min={schema.minimum}
          max={schema.maximum}
          placeholder={placeholder}
          className={`${baseClasses} ${errorClasses}`}
          required={required}
        />
      )
    }

    // Email → email input
    if (schema.format === 'email') {
      return (
        <input
          type="email"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
          className={`${baseClasses} ${errorClasses}`}
          required={required}
        />
      )
    }

    // URI → url input
    if (schema.format === 'uri') {
      return (
        <input
          type="url"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
          className={`${baseClasses} ${errorClasses}`}
          required={required}
        />
      )
    }

    // Default → text input
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        maxLength={schema.maxLength}
        className={`${baseClasses} ${errorClasses}`}
        required={required}
      />
    )
  }

  const hintParts: string[] = []
  if (description) hintParts.push(description)
  if (schema.example !== undefined && !description?.includes(String(schema.example))) {
    hintParts.push(`Example: ${schema.example}`)
  }
  const hint = hintParts.join(' — ')

  // Show type icon if we have an inferred or overridden type
  const showTypeIcon = Boolean(inferredType || typeOverride)
  const displayType = effectiveType ?? 'string'

  // Show clear button only if we have a value and an onClear handler
  const showClearButton = Boolean(onClear && value)

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 mb-1">
        <label className="block text-sm font-medium text-muted-foreground">
          {name}
          {required && <span className="text-red-500 ml-1">*</span>}
          {parameter.in === 'path' && (
            <span className="text-muted-foreground ml-1 font-normal text-xs">(path)</span>
          )}
        </label>
        {showTypeIcon && (
          <TypeIcon
            type={displayType}
            onTypeChange={onTypeOverride ?? (() => {})}
            disabled={!onTypeOverride}
          />
        )}
      </div>
      <div className="relative">
        {renderInput()}
        {showClearButton && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground focus:outline-none"
            title="Clear value"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {error && touched && (
        <p className="text-sm text-red-500 mt-1">{error}</p>
      )}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
