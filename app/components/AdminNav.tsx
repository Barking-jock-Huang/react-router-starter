import { useEffect, useState } from "react";
import { Link } from "react-router";

import { isLocalHost } from "../features/admin/local-host";

type AdminSection = "blog" | "changelog" | "resume" | "concert" | "ops";

interface AdminNavProps {
  active: AdminSection;
}

const NAV_ITEMS: { id: AdminSection; label: string; to: string; localOnly?: boolean }[] = [
  { id: "blog", label: "Blog", to: "/admin/blog-edit" },
  { id: "changelog", label: "Changelog", to: "/admin/changelog" },
  { id: "resume", label: "Resume", to: "/admin/resume-company" },
  { id: "concert", label: "Concert Intel", to: "/admin/concert-intel" },
  { id: "ops", label: "Ops/Git", to: "/admin/ops", localOnly: true },
];

export function AdminNav({ active }: AdminNavProps) {
  const [canUseLocalOps, setCanUseLocalOps] = useState(false);

  useEffect(() => {
    setCanUseLocalOps(isLocalHost(window.location.hostname));
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-1">
      <div className="flex flex-wrap items-center gap-1 rounded-xl bg-neutral-100 p-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active;
          if (item.localOnly && !canUseLocalOps) {
            return (
              <span
                key={item.id}
                title="Localhost only"
                className="cursor-not-allowed rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-300"
              >
                {item.label}
              </span>
            );
          }

          return (
            <Link
              key={item.id}
              to={item.to}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                isActive
                  ? "bg-white text-neutral-900 shadow-sm"
                  : "text-neutral-500 hover:bg-white/60 hover:text-neutral-700"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      <Link to="/jock_space" className="ml-2 px-2 py-1.5 text-xs text-neutral-400 hover:text-neutral-600">
        Back home
      </Link>
    </div>
  );
}
