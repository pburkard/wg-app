import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (_req) => {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const today = new Date().toISOString().split("T")[0];

  // Fetch all active recurring expenses due today or earlier
  const { data: recurring, error: fetchError } = await supabase
    .from("recurring_expenses")
    .select("*")
    .eq("active", true)
    .lte("next_due_date", today);

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let created = 0;

  for (const rec of recurring ?? []) {
    // Create the expense
    const { data: expense, error: expError } = await supabase
      .from("expenses")
      .insert({
        apartment_id: rec.apartment_id,
        paid_by: rec.paid_by,
        amount: rec.amount,
        description: rec.description,
        category: rec.category,
        date: rec.next_due_date,
        split_type: rec.split_type,
        recurring_expense_id: rec.id,
      })
      .select()
      .single();

    if (expError || !expense) continue;

    // Get apartment members for splits
    const { data: members } = await supabase
      .from("profiles")
      .select("id")
      .eq("apartment_id", rec.apartment_id);

    if (!members || members.length === 0) continue;

    let splits;
    if (rec.split_type === "custom" && rec.custom_splits) {
      const customMap = rec.custom_splits as Record<string, number>;
      splits = Object.entries(customMap).map(([userId, amount]) => ({
        expense_id: expense.id,
        user_id: userId,
        amount_owed: Math.round(Number(amount) * 100) / 100,
      }));
    } else {
      const splitAmount =
        Math.round((Number(rec.amount) / members.length) * 100) / 100;
      splits = members.map((m: { id: string }) => ({
        expense_id: expense.id,
        user_id: m.id,
        amount_owed: splitAmount,
      }));
    }

    await supabase.from("expense_splits").insert(splits);

    // Advance next_due_date using due_day / due_month
    const dueDay: number = rec.due_day ?? 0; // 0 = last day
    const dueMonth: number | null = rec.due_month ?? null;
    let nextDateStr: string;

    if (rec.frequency === "weekly") {
      // due_day: 1=Mon..7=Sun, 0=Sun (last day of week)
      const cur = new Date(rec.next_due_date);
      cur.setDate(cur.getDate() + 7);
      nextDateStr = cur.toISOString().split("T")[0];
    } else if (rec.frequency === "monthly") {
      const cur = new Date(rec.next_due_date);
      const nextMonth = cur.getMonth() + 1;
      const nextYear = cur.getFullYear() + (nextMonth > 11 ? 1 : 0);
      const month = nextMonth % 12;
      if (dueDay === 0) {
        // Last day of next month
        const lastDay = new Date(nextYear, month + 1, 0).getDate();
        nextDateStr = `${nextYear}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      } else {
        const lastDay = new Date(nextYear, month + 1, 0).getDate();
        const day = Math.min(dueDay, lastDay);
        nextDateStr = `${nextYear}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    } else {
      // yearly
      const cur = new Date(rec.next_due_date);
      const nextYear = cur.getFullYear() + 1;
      const m = (dueMonth ?? 12) - 1; // 0-indexed
      if (dueDay === 0) {
        const lastDay = new Date(nextYear, m + 1, 0).getDate();
        nextDateStr = `${nextYear}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      } else {
        const lastDay = new Date(nextYear, m + 1, 0).getDate();
        const day = Math.min(dueDay, lastDay);
        nextDateStr = `${nextYear}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }

    await supabase
      .from("recurring_expenses")
      .update({ next_due_date: nextDateStr })
      .eq("id", rec.id);

    // Notify apartment members
    const { data: profiles } = await supabase
      .from("profiles")
      .select("push_token, id")
      .eq("apartment_id", rec.apartment_id)
      .neq("id", rec.paid_by);

    for (const p of profiles ?? []) {
      if (!p.push_token) continue;
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: p.push_token,
          sound: "default",
          title: "Recurring Expense",
          body: `CHF ${Number(rec.amount).toFixed(2)} — ${rec.description}`,
        }),
      });
    }

    created++;
  }

  return new Response(JSON.stringify({ created }), {
    headers: { "Content-Type": "application/json" },
  });
});
