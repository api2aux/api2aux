/**
 * GraphQL introspection query and types for parsing introspection results.
 * Based on the GraphQL specification's introspection system.
 */

/** GraphQL type kinds from the introspection system. */
export const TypeKind = {
  SCALAR: 'SCALAR',
  OBJECT: 'OBJECT',
  ENUM: 'ENUM',
  INPUT_OBJECT: 'INPUT_OBJECT',
  NON_NULL: 'NON_NULL',
  LIST: 'LIST',
  UNION: 'UNION',
  INTERFACE: 'INTERFACE',
} as const
export type TypeKind = (typeof TypeKind)[keyof typeof TypeKind]

/** Introspection query covering types, fields, args, and enums. Omits possibleTypes and directives for simplicity. */
export const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind name description
      fields(includeDeprecated: false) {
        name description
        args { name description type { ...TypeRef } defaultValue }
        type { ...TypeRef }
      }
      inputFields { name description type { ...TypeRef } defaultValue }
      enumValues(includeDeprecated: false) { name description }
    }
  }
}
fragment TypeRef on __Type {
  kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } }
}`

export interface IntrospectionResult {
  data: { __schema: IntrospectionSchema }
}

export interface IntrospectionSchema {
  queryType: { name: string } | null
  mutationType: { name: string } | null
  subscriptionType: { name: string } | null
  types: IntrospectionType[]
}

export interface IntrospectionType {
  kind: TypeKind | string
  name: string
  description?: string | null
  fields?: IntrospectionField[] | null
  inputFields?: IntrospectionInputValue[] | null
  enumValues?: Array<{ name: string; description?: string | null }> | null
}

export interface IntrospectionField {
  name: string
  description?: string | null
  args: IntrospectionInputValue[]
  type: IntrospectionTypeRef
}

export interface IntrospectionInputValue {
  name: string
  description?: string | null
  type: IntrospectionTypeRef
  defaultValue?: string | null
}

export interface IntrospectionTypeRef {
  kind: TypeKind | string
  name: string | null
  ofType?: IntrospectionTypeRef | null
}
