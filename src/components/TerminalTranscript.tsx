import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const SCRIPT = [
  "> Init connection... [OK]",
  "> Auth: x402 payment header verified.",
  "> Routing to: +1 (415) 555-0199 [Il Corvo]",
  "> Status: Ringing...",
  "> Status: Connected.",
  "",
  "[Agent]: Hi, I'm calling to book a table for two this Friday at 7 PM.",
  "[Host]: Let me check... we have a 7:15 PM available, does that work?",
  "[Agent]: Yes, 7:15 PM is perfect. The name is Alex.",
  "[Host]: Great, you're all set for Friday at 7:15 PM.",
  "[Agent]: Thank you. Goodbye.",
  "",
  "> Status: Disconnected.",
  "> Task completed successfully.",
  "> Payment executed: 0.12 USDC",
  "> Standing by..."
];

export function TerminalTranscript() {
  const [lines, setLines] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < SCRIPT.length) {
      const timer = setTimeout(() => {
        setLines(prev => [...prev, SCRIPT[currentIndex]]);
        setCurrentIndex(prev => prev + 1);
      }, SCRIPT[currentIndex] === "" ? 400 : Math.random() * 800 + 400); // Random delay for realism
      return () => clearTimeout(timer);
    } else {
      // Loop after a delay
      const resetTimer = setTimeout(() => {
        setLines([]);
        setCurrentIndex(0);
      }, 5000);
      return () => clearTimeout(resetTimer);
    }
  }, [currentIndex]);

  return (
    <div className="w-full max-w-2xl mx-auto border border-border bg-[#050505] shadow-xl overflow-hidden font-mono text-sm relative group">
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-[#0a0a0a]">
        <div className="flex space-x-2">
          <div className="w-3 h-3 rounded-full bg-destructive/50"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
          <div className="w-3 h-3 rounded-full bg-primary/50"></div>
        </div>
        <div className="text-xs text-muted-foreground uppercase tracking-widest opacity-50">agent_runner.sh</div>
      </div>
      
      {/* Terminal Body */}
      <div className="p-6 h-[320px] overflow-y-auto terminal-scroll flex flex-col justify-end">
        <div className="flex flex-col space-y-1">
          {lines.map((line, i) => (
            <motion.div 
              key={`${i}-${line}`}
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              className={`${
                line.startsWith(">") ? "text-primary/70" : 
                line.startsWith("[Agent]") ? "text-primary font-bold" : 
                line.startsWith("[Host]") ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {line}
            </motion.div>
          ))}
          <motion.div 
            animate={{ opacity: [1, 0] }} 
            transition={{ repeat: Infinity, duration: 0.8 }}
            className="w-2 h-4 bg-primary mt-1 inline-block"
          />
        </div>
      </div>
      
      {/* Glow effect */}
      <div className="absolute inset-0 pointer-events-none border border-primary/10 group-hover:border-primary/30 transition-colors duration-700"></div>
    </div>
  );
}
