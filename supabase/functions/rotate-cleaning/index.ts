import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  // This function is called by pg_cron daily at 08:00
  // It rotates cleaning tasks whose frequency has elapsed

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: tasks, error: fetchError } = await supabase
    .from("cleaning_tasks")
    .select("*")
    .not("last_rotated_at", "is", null);

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  let rotated = 0;

  for (const task of tasks) {
    const lastRotated = new Date(task.last_rotated_at);
    const daysSince = (now.getTime() - lastRotated.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSince < task.frequency_days) continue;
    if (task.rotation_order.length === 0) continue;

    const newIndex = (task.current_index + 1) % task.rotation_order.length;
    const assignedUserId = task.rotation_order[newIndex];

    // Update the task
    await supabase
      .from("cleaning_tasks")
      .update({
        current_index: newIndex,
        last_rotated_at: now.toISOString(),
      })
      .eq("id", task.id);

    // Send push notification to the newly assigned user
    const { data: profile } = await supabase
      .from("profiles")
      .select("push_token, display_name")
      .eq("id", assignedUserId)
      .single();

    if (profile?.push_token) {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: profile.push_token,
          sound: "default",
          title: "It's your turn!",
          body: `Time to clean: ${task.name}`,
        }),
      });
    }

    rotated++;
  }

  return new Response(
    JSON.stringify({ rotated }),
    { headers: { "Content-Type": "application/json" } },
  );
});
