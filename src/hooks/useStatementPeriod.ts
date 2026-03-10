import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useStatementPeriod() {
  const [currentPeriod, setCurrentPeriod] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("statement_periods")
      .select("name")
      .eq("is_current", true)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setCurrentPeriod(data.name);
      });
  }, []);

  return { currentPeriod };
}
