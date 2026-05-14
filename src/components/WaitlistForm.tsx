import { useState, useRef } from "react";
import { useJoinWaitlist, useGetWaitlistCount, getGetWaitlistCountQueryKey } from "@/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2 } from "lucide-react";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const queryClient = useQueryClient();

  const joinWaitlist = useJoinWaitlist();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setStatus("loading");
    setErrorMessage("");

    joinWaitlist.mutate({ data: { email } }, {
      onSuccess: () => {
        setStatus("success");
        queryClient.invalidateQueries({ queryKey: getGetWaitlistCountQueryKey() });
        setEmail("");
      },
      onError: (error: any) => {
        setStatus("error");
        // The API returns a 409 status with a specific error message, handle it
        if (error?.status === 409 || error?.response?.status === 409 || error?.error?.includes("already")) {
           setErrorMessage("You're already on the list.");
        } else {
           setErrorMessage(error?.error || "Failed to join waitlist. Try again.");
        }
      }
    });
  };

  if (status === "success") {
    return (
      <div className="flex items-center space-x-2 text-primary border border-primary/30 bg-primary/5 p-3 rounded-none">
        <CheckCircle2 className="w-5 h-5" />
        <span className="text-sm font-bold uppercase tracking-wider">Access granted. Standing by.</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md relative group">
      <div className="absolute -inset-0.5 bg-primary/20 blur opacity-0 group-focus-within:opacity-100 transition duration-500"></div>
      <div className="relative flex items-stretch space-x-2">
        <Input
          type="email"
          placeholder="ENTER_EMAIL_ADDRESS"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 bg-background border-border focus-visible:ring-primary focus-visible:border-primary uppercase placeholder:text-muted-foreground/50 rounded-none h-12 px-4"
          required
          disabled={status === "loading"}
        />
        <Button 
          type="submit" 
          disabled={status === "loading" || !email}
          className="rounded-none h-12 px-6 font-bold uppercase tracking-widest neon-glow hover:bg-primary hover:text-primary-foreground transition-all duration-300"
        >
          {status === "loading" ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            "Execute"
          )}
        </Button>
      </div>
      {status === "error" && (
        <p className="mt-2 text-sm text-destructive uppercase tracking-wide">
          <span className="font-bold mr-2">ERR:</span>{errorMessage}
        </p>
      )}
    </form>
  );
}
