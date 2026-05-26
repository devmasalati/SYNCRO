import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "./route"
import * as supabaseServer from "@/lib/supabase/server"

// Mock supabase client
const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockResolvedValue({ error: null }),
  eq: vi.fn().mockReturnThis(),
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => mockSupabase),
}))

// Helper to create a FormData request
function createFormDataRequest(fields: Record<string, any>, fileContent?: string) {
  const formData = new FormData()
  Object.entries(fields).forEach(([k, v]) => {
    if (k === 'file') {
      const blob = new Blob([fileContent ?? ""], { type: 'text/csv' })
      formData.append(k, blob, 'test.csv')
    } else {
      formData.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
  })

  return new NextRequest("http://localhost/api/subscriptions/import", {
    method: "POST",
    body: formData,
  })
}

describe("CSV Import API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-123" } } })
    mockSupabase.select.mockResolvedValue({ data: [] }) // No existing subscriptions by default
  })

  describe("Mapping Discovery", () => {
    it("returns headers and sample rows when no mappings are provided", async () => {
      const csv = "CustomName,CustomPrice,CustomCycle\nNetflix,15.99,monthly\nDisney+,7.99,monthly"
      const req = createFormDataRequest({ file: true }, csv)
      
      const res = await POST(req)
      const json = await res.json()

      expect(json.success).toBe(true)
      expect(json.data.headers).toEqual(["CustomName", "CustomPrice", "CustomCycle"])
      expect(json.data.sampleRows).toHaveLength(2)
      expect(json.data.sampleRows[0]).toEqual({
        CustomName: "Netflix",
        CustomPrice: "15.99",
        CustomCycle: "monthly"
      })
    })

    it("handles BOM correctly", async () => {
      const csv = "\uFEFFHeader1,Header2\nValue1,Value2"
      const req = createFormDataRequest({ file: true }, csv)
      
      const res = await POST(req)
      const json = await res.json()

      expect(json.success).toBe(true)
      expect(json.data.headers[0]).toBe("Header1")
    })
  })

  describe("Mapping Enforcement", () => {
    it("uses mappings to validate rows", async () => {
      const csv = "CSV_NAME,CSV_PRICE,CSV_CYCLE\nNetflix,15.99,monthly"
      const mappings = {
        name: "CSV_NAME",
        price: "CSV_PRICE",
        billing_cycle: "CSV_CYCLE"
      }
      const req = createFormDataRequest({ file: true, mappings }, csv)
      
      const res = await POST(req)
      const json = await res.json()

      expect(json.success).toBe(true)
      expect(json.data.preview.rows[0].status).toBe("valid")
      expect(json.data.preview.rows[0].data.name).toBe("Netflix")
    })

    it("detects duplicates even with mappings", async () => {
      mockSupabase.select.mockResolvedValue({ data: [{ id: "sub-1", name: "Netflix" }] })
      
      const csv = "CSV_NAME,CSV_PRICE,CSV_CYCLE\nNetflix,15.99,monthly"
      const mappings = {
        name: "CSV_NAME",
        price: "CSV_PRICE",
        billing_cycle: "CSV_CYCLE"
      }
      const req = createFormDataRequest({ file: true, mappings }, csv)
      
      const res = await POST(req)
      const json = await res.json()

      expect(json.success).toBe(true)
      expect(json.data.preview.rows[0].status).toBe("duplicate")
      expect(json.data.preview.rows[0].duplicateId).toBe("sub-1")
    })
  })

  describe("Edge Cases", () => {
    it("returns 400 for empty CSV", async () => {
      const req = createFormDataRequest({ file: true }, "")
      const res = await POST(req)
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toMatch(/no data rows/)
    })

    it("returns 400 if user is not authenticated", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
      const req = createFormDataRequest({ file: true }, "a,b\n1,2")
      const res = await POST(req)
      const json = await res.json()

      expect(res.status).toBe(401)
    })
  })
})
