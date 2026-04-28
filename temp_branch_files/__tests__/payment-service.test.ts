import { describe, it, expect, vi, beforeEach } from "vitest"
import { PaymentService } from "../payment-service"
import { mockSupabaseClient, mockStripeClient } from "../test-utils/mocks"
import { createClient } from "../supabase/server"
import { getStripeInstance } from "../stripe-config"

// Mock the dependencies
vi.mock("../supabase/server", () => ({
  createClient: vi.fn(),
}))

vi.mock("../stripe-config", () => ({
  getStripeInstance: vi.fn(),
  stripeConfig: {},
}))

describe("PaymentService", () => {
  let supabase: any
  let stripe: any

  beforeEach(() => {
    vi.clearAllMocks()
    supabase = mockSupabaseClient()
    stripe = mockStripeClient()
    
    vi.mocked(createClient).mockResolvedValue(supabase as any)
    vi.mocked(getStripeInstance).mockReturnValue(stripe as any)
  })

  describe("Stripe Provider", () => {
    it("should process a successful Stripe payment and save to DB", async () => {
      const service = new PaymentService({ provider: "stripe", apiKey: "test_key" })
      const amount = 100
      const metadata = { userId: "user_123", planName: "Premium" }

      stripe.paymentIntents.create.mockResolvedValue({
        id: "pi_123",
        status: "succeeded",
      })

      const result = await service.processPayment(amount, "usd", "pm_123", metadata)

      expect(result.success).toBe(true)
      expect(result.transactionId).toBe("pi_123")
      expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10000,
          currency: "usd",
          payment_method: "pm_123",
        })
      )
      
      // Verify DB insert
      expect(supabase.from).toHaveBeenCalledWith("payments")
      expect(supabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          amount,
          transaction_id: "pi_123",
          provider: "stripe",
          user_id: "user_123",
        })
      )
    })

    it("should handle Stripe payment failure and NOT save to DB", async () => {
      const service = new PaymentService({ provider: "stripe" })
      
      stripe.paymentIntents.create.mockRejectedValue(new Error("Card declined"))

      const result = await service.processPayment(100, "usd", "pm_fail")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Card declined")
      
      // Verify NO DB insert
      expect(supabase.insert).not.toHaveBeenCalled()
    })

    it("should return error if Stripe is not configured", async () => {
      vi.mocked(getStripeInstance).mockReturnValue(null as any)
      const service = new PaymentService({ provider: "stripe" })
      
      const result = await service.processPayment(100, "usd", "pm_123")
      
      expect(result.success).toBe(false)
      expect(result.error).toBe("Stripe not configured")
    })
  })

  describe("PayPal Provider", () => {
    it("should process a successful PayPal payment (mocked) and save to DB", async () => {
      const service = new PaymentService({ provider: "paypal" })
      const amount = 50

      const result = await service.processPayment(amount, "usd", "paypal_pm_123", { userId: "u1" })

      expect(result.success).toBe(true)
      expect(result.transactionId).toContain("paypal_")
      
      // Verify DB insert
      expect(supabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          amount,
          provider: "paypal",
        })
      )
    })
  })

  describe("Mock Provider", () => {
    it("should process a successful mock payment and save to DB", async () => {
      const service = new PaymentService({ provider: "mock" })
      
      const result = await service.processPayment(10, "usd", "none")

      expect(result.success).toBe(true)
      expect(result.transactionId).toContain("mock_")
      expect(supabase.insert).toHaveBeenCalled()
    })
  })

  describe("Refunds", () => {
    it("should refund a Stripe payment and update DB", async () => {
      const service = new PaymentService({ provider: "stripe" })
      stripe.refunds.create.mockResolvedValue({ id: "re_123" })

      const result = await service.refundPayment("pi_123")

      expect(result.success).toBe(true)
      expect(result.transactionId).toBe("re_123")
      expect(stripe.refunds.create).toHaveBeenCalledWith({
        payment_intent: "pi_123",
      })
      
      // Verify DB update
      expect(supabase.update).toHaveBeenCalledWith({ status: "refunded" })
      expect(supabase.eq).toHaveBeenCalledWith("transaction_id", "pi_123")
    })

    it("should handle Stripe refund failure", async () => {
      const service = new PaymentService({ provider: "stripe" })
      stripe.refunds.create.mockRejectedValue(new Error("Refund failed"))

      const result = await service.refundPayment("pi_123")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Refund failed")
      expect(supabase.update).not.toHaveBeenCalled()
    })

    it("should successfully refund for non-stripe providers (fallback)", async () => {
      const service = new PaymentService({ provider: "mock" })
      
      const result = await service.refundPayment("some_id")

      expect(result.success).toBe(true)
      expect(result.transactionId).toContain("refund_")
    })
  })

  describe("Database Error Handling", () => {
    it("should catch and log database errors but return successful payment result", async () => {
      const service = new PaymentService({ provider: "mock" })
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      
      // Mock DB insert to fail
      supabase.insert.mockRejectedValue(new Error("DB Connection Error"))

      const result = await service.processPayment(100, "usd", "pm_123")

      expect(result.success).toBe(true) // Payment still succeeded
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to save payment to database:",
        expect.any(Error)
      )
      
      consoleSpy.mockRestore()
    })
  })
})
