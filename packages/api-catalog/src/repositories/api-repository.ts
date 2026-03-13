/**
 * Data access layer for APIs and operations.
 * All database queries live here — no business logic.
 */

import { eq, and, isNull, sql, count } from 'drizzle-orm'
import { apis, apiOperations } from '../db/schema'
import type { Database } from '../types'

export type ApiRecord = typeof apis.$inferSelect
export type ApiInsert = typeof apis.$inferInsert
export type OperationRecord = typeof apiOperations.$inferSelect

export interface SearchConditions {
  category?: string
  subcategory?: string
  authType?: string
  freeTier?: string
  corsSupport?: string
  hasSpec?: boolean | null
  status?: string
  textPattern?: string  // LIKE pattern for name/description
}

export class ApiRepository {
  constructor(private db: Database) {}

  findById(id: string): ApiRecord | undefined {
    return this.db.select().from(apis).where(eq(apis.id, id)).get()
  }

  findOperationsByApiId(apiId: string): OperationRecord[] {
    return this.db
      .select()
      .from(apiOperations)
      .where(eq(apiOperations.apiId, apiId))
      .all()
  }

  search(conditions: SearchConditions, limit: number, offset: number): { items: ApiRecord[]; total: number } {
    const where = this.buildWhere(conditions)

    const items = this.db
      .select()
      .from(apis)
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(apis.name)
      .all()

    const totalResult = this.db
      .select({ count: count() })
      .from(apis)
      .where(where)
      .get()

    return { items, total: totalResult?.count ?? 0 }
  }

  facets() {
    const activeFilter = isNull(apis.deletedAt)

    const categories = this.db
      .select({ value: apis.category, count: count() })
      .from(apis)
      .where(activeFilter)
      .groupBy(apis.category)
      .orderBy(sql`count(*) DESC`)
      .all()

    const authTypes = this.db
      .select({ value: apis.authType, count: count() })
      .from(apis)
      .where(activeFilter)
      .groupBy(apis.authType)
      .orderBy(sql`count(*) DESC`)
      .all()

    const freeTiers = this.db
      .select({ value: apis.freeTier, count: count() })
      .from(apis)
      .where(and(activeFilter, sql`${apis.freeTier} IS NOT NULL`))
      .groupBy(apis.freeTier)
      .orderBy(sql`count(*) DESC`)
      .all() as { value: string; count: number }[]

    const statuses = this.db
      .select({ value: apis.status, count: count() })
      .from(apis)
      .where(activeFilter)
      .groupBy(apis.status)
      .orderBy(sql`count(*) DESC`)
      .all()

    return { categories, authTypes, freeTiers, statuses }
  }

  insert(values: ApiInsert): ApiRecord | undefined {
    this.db.insert(apis).values(values).run()
    return this.findById(values.id)
  }

  update(id: string, values: Partial<ApiInsert>): ApiRecord | undefined {
    this.db.update(apis)
      .set({ ...values, updatedAt: sql`(datetime('now'))` })
      .where(eq(apis.id, id))
      .run()
    return this.findById(id)
  }

  softDelete(id: string): void {
    this.db.update(apis)
      .set({ deletedAt: sql`(datetime('now'))`, updatedAt: sql`(datetime('now'))` })
      .where(eq(apis.id, id))
      .run()
  }

  private buildWhere(conditions: SearchConditions) {
    const clauses = []

    clauses.push(isNull(apis.deletedAt))

    if (conditions.category) clauses.push(eq(apis.category, conditions.category))
    if (conditions.subcategory) clauses.push(eq(apis.subcategory, conditions.subcategory))
    if (conditions.authType) clauses.push(eq(apis.authType, conditions.authType))
    if (conditions.freeTier) clauses.push(eq(apis.freeTier, conditions.freeTier))
    if (conditions.corsSupport) clauses.push(eq(apis.corsSupport, conditions.corsSupport))
    if (conditions.status) clauses.push(eq(apis.status, conditions.status))
    if (conditions.hasSpec === true) clauses.push(eq(apis.hasSpec, 1))
    if (conditions.hasSpec === false) clauses.push(eq(apis.hasSpec, 0))
    if (conditions.textPattern) {
      clauses.push(
        sql`(${apis.name} LIKE ${conditions.textPattern} OR ${apis.description} LIKE ${conditions.textPattern})`
      )
    }

    return clauses.length > 0 ? and(...clauses) : undefined
  }
}
