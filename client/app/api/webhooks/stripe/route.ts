import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/supabase/server"
import { getStripeInstance } from "@/lib/stripe-config"
import { ApiErrors } from "@/lib/api/index"

export async function POST(request: NextRequest) {
  const stripe = getStripeInstance()
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  let event: Stripe.Event

  try {
    if (!signature || !webhookSecret) {
      throw ApiErrors.validationError("Missing stripe-signature or webhook secret")
    }
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    console.error(`Webhook signature verification failed: ${errorMessage}`)
    return NextResponse.json({ error: `Webhook Error: ${errorMessage}` }, { status: 400 })
  }

  const supabase = await createClient()

  try {
    // Handle the event
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntentSucceeded = event.data.object as Stripe.PaymentIntent
        console.log(`PaymentIntent for ${paymentIntentSucceeded.amount} was successful!`)

        // Update payment status in database
        const { error: paymentUpdateError } = await supabase
          .from("payments")
          .update({ status: "succeeded" })
          .eq("transaction_id", paymentIntentSucceeded.id)

        if (paymentUpdateError) {
          console.error("[Webhook] Failed to update payment status:", paymentUpdateError)
          return NextResponse.json(
            { error: "Database error: payment update failed" },
            { status: 500 }
          )
        }

        // Update user profile if metadata is present
        if (paymentIntentSucceeded.metadata?.userId) {
          const { error: profileUpdateError } = await supabase
            .from("profiles")
            .update({
              subscription_tier: paymentIntentSucceeded.metadata.planName
            })
            .eq("id", paymentIntentSucceeded.metadata.userId)

          if (profileUpdateError) {
            console.error("[Webhook] Failed to update user profile:", profileUpdateError)
            return NextResponse.json(
              { error: "Database error: profile update failed" },
              { status: 500 }
            )
          }
        }
        break
      }

      case "payment_intent.payment_failed": {
        const paymentIntentFailed = event.data.object as Stripe.PaymentIntent
        console.log(`PaymentIntent for ${paymentIntentFailed.amount} failed.`)

        const { error: failUpdateError } = await supabase
          .from("payments")
          .update({ status: "failed" })
          .eq("transaction_id", paymentIntentFailed.id)

        if (failUpdateError) {
          console.error("[Webhook] Failed to update payment failure status:", failUpdateError)
          return NextResponse.json(
            { error: "Database error: payment failure update failed" },
            { status: 500 }
          )
        }
        break
      }

      default:
        console.log(`Unhandled event type ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("[Webhook] Unexpected error processing event:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export const config = {
  api: {
    bodyParser: false, // Stripe webhooks need raw body
  },
}
