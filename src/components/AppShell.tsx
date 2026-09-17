import { Link, useRouterState } from "@tanstack/react-router";
import {
  CreditCard,
  LayoutDashboard,
  ListOrdered,
  Moon,
  Plus,
  Repeat,
  Settings,
  Sun,
  WifiOff,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { TransactionDialog } from "@/components/TransactionDialog";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Resumo", icon: LayoutDashboard },
  { to: "/recorrencias", label: "Recorrências", icon: Repeat },
  { to: "/cartoes", label: "Cartões", icon: CreditCard },
  { to: "/historico", label: "Histórico", icon: ListOrdered },
  { to: "/ajustes", label: "Ajustes", icon: Settings },
] as const;

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem("bs-wallet-theme");
    const isDark = stored ? stored === "dark" : false;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);
  const toggle = () => {
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem("bs-wallet-theme", next ? "dark" : "light");
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  };
  return { dark, toggle };
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function AppShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { dark, toggle } = useTheme();
  const online = useOnline();
  const [openTx, setOpenTx] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isActive = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar p-4 lg:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold">
            BS
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">BS Wallet</p>
            <p className="text-xs text-muted-foreground">Controle familiar</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive(item.to)
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <Button className="mt-4" onClick={() => setOpenTx(true)}>
          <Plus className="size-4" /> Adicionar lançamento
        </Button>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
              {subtitle ? (
                <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {action}
              <Button variant="ghost" size="icon" onClick={toggle} aria-label="Alternar tema">
                {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </Button>
            </div>
          </div>
          {!online ? (
            <div className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-1.5 text-xs text-warning">
              <WifiOff className="size-3.5" /> Você está offline — os dados continuam salvos neste
              aparelho.
            </div>
          ) : null}
        </header>

        <main className="mx-auto max-w-5xl px-4 pb-32 pt-5 lg:pb-12">{children}</main>
      </div>

      <Button
        onClick={() => setOpenTx(true)}
        className="fixed bottom-24 right-4 z-30 size-14 rounded-full shadow-lg lg:hidden"
        aria-label="Adicionar lançamento"
      >
        <Plus className="size-6" />
      </Button>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="grid grid-cols-5">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                isActive(item.to) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      <TransactionDialog open={openTx} onOpenChange={setOpenTx} />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
