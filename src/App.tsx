import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mail,
  Send,
  CalendarClock,
  Plus,
  Search,
  LogOut,
  Slack,
  Upload,
  X,
  RefreshCw,
  ExternalLink,
  ShieldCheck
} from "lucide-react";

import { api, apiBase } from "./api";
import type { AuthUser } from "./api";
import type { EmailRow, Sender } from "./types";

// Extract unique email addresses from uploaded CSV/TXT files.
function parseLeads(text: string): string[] {
  return [
    ...new Set(
      (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
        .map(email => email.toLowerCase())
    )
  ];
}

export default function App() {
  // Authentication state
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  // Dashboard state
  const [tab, setTab] = useState<"scheduled" | "sent">("scheduled");
  const [scheduled, setScheduled] = useState<EmailRow[]>([]);
  const [sent, setSent] = useState<EmailRow[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // Elasticsearch search state
  const [searchResults, setSearchResults] = useState<EmailRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRequestId = useRef(0);

  // Campaign composition state
  const [compose, setCompose] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [startTime, setStartTime] = useState("");
  const [delay, setDelay] = useState(2000);
  const [hourlyLimit, setHourlyLimit] = useState(100);
  const [senderId, setSenderId] = useState("");
  const [leads, setLeads] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  // Load authenticated user's dashboard data.
  async function refresh() {
    setLoading(true);
    setError("");

    try {
      const [scheduledRows, sentRows, senderRows] = await Promise.all([
        api.scheduled(),
        api.sent(),
        api.senders()
      ]);

      setScheduled(scheduledRows);
      setSent(sentRows);
      setSenders(senderRows);

      setSenderId(current => current || senderRows[0]?.id || "");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load dashboard"
      );
    } finally {
      setLoading(false);
    }
  }

  // Check existing Passport session when application loads.
  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        const result = await api.me();

        if (!active) return;

        setUser(result.user);

        if (result.user) {
          await refresh();
        }
      } catch {
        if (active) {
          setUser(null);
        }
      } finally {
        if (active) {
          setAuthLoading(false);
          setLoading(false);
        }
      }
    }

    void checkSession();

    return () => {
      active = false;
    };
  }, []);

  // Elasticsearch search with a short debounce.
  useEffect(() => {
    const query = search.trim();
    const requestId = ++searchRequestId.current;

    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    const timeout = window.setTimeout(async () => {
      setSearchLoading(true);

      try {
        const results = await api.search(query);

        // Ignore responses from older searches.
        if (requestId !== searchRequestId.current) return;

        setSearchResults(results as EmailRow[]);
      } catch (e) {
        if (requestId !== searchRequestId.current) return;

        setSearchResults([]);
        setError(
          e instanceof Error
            ? `Search failed: ${e.message}`
            : "Elasticsearch search failed"
        );
      } finally {
        if (requestId === searchRequestId.current) {
          setSearchLoading(false);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [search]);

  // Display Elasticsearch results when searching.
  // Otherwise display the regular dashboard data.
  const rows = useMemo(() => {
    const source = search.trim()
      ? searchResults
      : tab === "scheduled"
        ? scheduled
        : sent;

    if (tab === "scheduled") {
      return source.filter(row =>
        row.status === "SCHEDULED" ||
        row.status === "PROCESSING"
      );
    }

    return source.filter(row =>
      row.status === "SENT" ||
      row.status === "FAILED"
    );
  }, [tab, scheduled, sent, search, searchResults]);

  // Google sign-in.
  function loginWithGoogle() {
    window.location.href = `${apiBase}/api/auth/google`;
  }

  // Logout.
  async function logout() {
    setLoggingOut(true);

    try {
      await api.logout();

      setUser(null);
      setScheduled([]);
      setSent([]);
      setSenders([]);
      setSearchResults([]);
      setSearch("");
      setCompose(false);
      setNotice("");
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not log out"
      );
    } finally {
      setLoggingOut(false);
    }
  }

  // Schedule email campaign.
  async function schedule() {
    if (
      !subject.trim() ||
      !body.trim() ||
      !leads.length ||
      !senderId ||
      !startTime
    ) {
      setNotice(
        "Complete all fields, add recipients and configure a sender first."
      );
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      const result = await api.createCampaign({
        subject,
        body,
        recipients: leads,
        senderId,
        startTime: new Date(startTime).toISOString(),
        delayBetweenEmails: Number(delay),
        hourlyLimit: Number(hourlyLimit)
      });

      setNotice(
        `Campaign created: ${result.total} emails scheduled.`
      );

      setCompose(false);
      setLeads([]);
      setSubject("");
      setBody("");
      setStartTime("");

      await refresh();
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Scheduling failed"
      );
    } finally {
      setBusy(false);
    }
  }

  // Add SMTP sender.
  async function addSender() {
    const email = prompt("Sender email address");

    const smtpUser = email
      ? prompt("Ethereal SMTP username")
      : null;

    const smtpPassword = smtpUser
      ? prompt("Ethereal SMTP password")
      : null;

    if (!email || !smtpUser || !smtpPassword) return;

    try {
      await api.addSender({
        email,
        smtpUser,
        smtpPassword
      });

      await refresh();
      setNotice("Sender added successfully.");
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not add sender"
      );
    }
  }

  // Test Slack integration.
  async function testSlack() {
    setBusy(true);
    setNotice("");

    try {
      const result = await api.testSlack();
      setNotice(result.message);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Slack test failed"
      );
    } finally {
      setBusy(false);
    }
  }

  // Authentication loading screen.
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Mail className="mx-auto text-indigo-600 mb-3" size={36} />
          <p className="text-slate-600 font-medium">
            Checking your session...
          </p>
        </div>
      </div>
    );
  }

  // Google sign-in screen.
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-lg p-8 w-full max-w-md text-center">
          <div className="mx-auto w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white mb-5">
            <Mail size={30} />
          </div>

          <h1 className="text-2xl font-bold text-slate-900">
            ReachInbox
          </h1>

          <p className="text-slate-500 mt-2">
            Your intelligent email scheduling platform.
          </p>

          <div className="mt-8">
            <button
              onClick={loginWithGoogle}
              className="w-full flex items-center justify-center gap-3 border border-slate-300 rounded-lg px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  transform="translate(0 4)"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.75 7.18l7.73 6C44.42 37.98 46.98 31.8 46.98 24.55z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.75-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.9 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>

              Continue with Google
            </button>
          </div>

          <div className="flex items-center justify-center gap-2 mt-6 text-xs text-slate-400">
            <ShieldCheck size={15} />
            Secure authentication with Google
          </div>

          {new URLSearchParams(window.location.search).get("login") === "failed" && (
            <div className="mt-5 p-3 bg-red-50 text-red-700 text-sm rounded-lg">
              Google sign-in failed. Please try again.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Authenticated dashboard.
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white rounded-xl p-2">
              <Mail size={21} />
            </div>

            <div>
              <div className="font-bold text-lg">ReachInbox</div>
              <div className="text-xs text-slate-500">
                Email scheduler
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt="Profile"
                className="w-9 h-9 rounded-full object-cover"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                {user.name?.charAt(0)?.toUpperCase() || "U"}
              </div>
            )}

            <div className="text-right hidden sm:block">
              <div className="font-semibold">{user.name}</div>
              <div className="text-slate-500">{user.email}</div>
            </div>

            <button
              onClick={() => void logout()}
              disabled={loggingOut}
              className="text-slate-500 hover:text-red-600 disabled:opacity-50"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Dashboard heading and actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-7">
          <div>
            <h1 className="text-2xl font-bold">
              Email campaigns
            </h1>
            <p className="text-slate-500 mt-1">
              Schedule, monitor and search your email activity.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void addSender()}
              className="border bg-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              Add sender
            </button>

            <a
              href={`${apiBase}/api/slack/connect`}
              className="border bg-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-slate-50"
            >
              <Slack size={16} />
              Connect Slack
            </a>

            <button
              onClick={() => void testSlack()}
              disabled={busy}
              className="border bg-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              Test Slack
            </button>

            <button
              onClick={() => setCompose(true)}
              className="bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-indigo-700"
            >
              <Plus size={17} />
              Compose new email
            </button>
          </div>
        </div>

        {notice && (
          <div className="mb-4 p-3 rounded-lg bg-indigo-50 text-indigo-800 text-sm">
            {notice}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Statistics */}
        <div className="grid sm:grid-cols-3 gap-4 mb-6">
          <Stat
            icon={<CalendarClock />}
            label="Scheduled"
            value={scheduled.length}
          />

          <Stat
            icon={<Send />}
            label="Sent / failed"
            value={sent.length}
          />

          <Stat
            icon={<Mail />}
            label="Configured senders"
            value={senders.length}
          />
        </div>

        {/* Email activity */}
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm">
          <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between gap-4">
            <div className="flex gap-2">
              <button
                onClick={() => setTab("scheduled")}
                className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                  tab === "scheduled"
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                Scheduled emails
              </button>

              <button
                onClick={() => setTab("sent")}
                className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                  tab === "sent"
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                Sent emails
              </button>
            </div>

            <div className="flex gap-2">
              <div className="relative">
                <Search
                  className="absolute left-3 top-2.5 text-slate-400"
                  size={17}
                />

                <input
                  value={search}
                  onChange={e => {
                    setSearch(e.target.value);
                    setError("");
                  }}
                  placeholder="Search email or subject"
                  className="border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <button
                onClick={() => void refresh()}
                className="border rounded-lg px-3 text-slate-600 hover:bg-slate-50"
                title="Refresh"
              >
                <RefreshCw size={17} />
              </button>
            </div>
          </div>

          {(loading || searchLoading) ? (
            <div className="p-14 text-center text-slate-500">
              {searchLoading
                ? "Searching with Elasticsearch..."
                : "Loading emails..."}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-14 text-center">
              <div className="mx-auto w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                <Mail className="text-slate-400" />
              </div>

              <div className="font-semibold">
                {search.trim()
                  ? "No matching emails found"
                  : `No ${tab} emails yet`}
              </div>

              <p className="text-sm text-slate-500 mt-1">
                {search.trim()
                  ? "Try another recipient address or subject."
                  : "Your email activity will appear here."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {[
                      "Recipient",
                      "Subject",
                      tab === "scheduled" ? "Scheduled time" : "Sent time",
                      "Status",
                      "Preview"
                    ].map(column => (
                      <th
                        key={column}
                        className="px-5 py-3 font-medium"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {rows.map(row => (
                    <tr
                      key={row.id}
                      className="border-t border-slate-100"
                    >
                      <td className="px-5 py-4 font-medium">
                        {row.recipient}
                      </td>

                      <td className="px-5 py-4 max-w-xs truncate">
                        {row.subject}
                      </td>

                      <td className="px-5 py-4 text-slate-500">
                        {new Date(
                          tab === "scheduled"
                            ? row.scheduledAt
                            : row.sentAt || row.scheduledAt
                        ).toLocaleString()}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            row.status === "SENT"
                              ? "bg-green-50 text-green-700"
                              : row.status === "FAILED"
                                ? "bg-red-50 text-red-700"
                                : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {row.status.toLowerCase()}
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        {row.previewUrl ? (
                          <a
                            className="text-indigo-600 flex items-center gap-1"
                            href={row.previewUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open
                            <ExternalLink size={13} />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="text-xs text-slate-400 mt-4">
          Queue monitor:{" "}
          <a
            className="underline"
            href={`${apiBase}/admin/queues`}
            target="_blank"
            rel="noreferrer"
          >
            Bull Board
          </a>
          {" · "}
          API health:{" "}
          <a
            className="underline"
            href={`${apiBase}/api/health`}
            target="_blank"
            rel="noreferrer"
          >
            Check status
          </a>
        </p>
      </main>

      {/* Compose campaign modal */}
      {compose && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
            <div className="p-5 border-b flex justify-between items-center">
              <div>
                <h2 className="font-bold text-lg">
                  Compose campaign
                </h2>
                <p className="text-sm text-slate-500">
                  Upload leads and configure sending.
                </p>
              </div>

              <button onClick={() => setCompose(false)}>
                <X />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <Field label="Subject">
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="field"
                  placeholder="Your email subject"
                />
              </Field>

              <Field label="Email body">
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={4}
                  className="field"
                  placeholder="Write your message..."
                />
              </Field>

              <Field label="Upload CSV or text file">
                <label className="border-2 border-dashed rounded-xl p-5 flex items-center justify-center gap-3 cursor-pointer hover:bg-slate-50">
                  <Upload className="text-indigo-600" />

                  <span className="text-sm text-slate-600">
                    Choose a .csv or .txt file
                  </span>

                  <input
                    type="file"
                    accept=".csv,.txt,text/plain,text/csv"
                    className="hidden"
                    onChange={async e => {
                      const file = e.target.files?.[0];

                      if (file) {
                        setLeads(parseLeads(await file.text()));
                      }

                      e.target.value = "";
                    }}
                  />
                </label>

                <p className="text-xs text-slate-500 mt-1">
                  {leads.length} unique email addresses detected
                </p>
              </Field>

              <Field label="Sender">
                <select
                  value={senderId}
                  onChange={e => setSenderId(e.target.value)}
                  className="field"
                >
                  <option value="">Select sender</option>

                  {senders.map(sender => (
                    <option key={sender.id} value={sender.id}>
                      {sender.email}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Start time">
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className="field"
                  />
                </Field>

                <Field label="Delay (ms)">
                  <input
                    type="number"
                    min="0"
                    value={delay}
                    onChange={e => setDelay(Number(e.target.value))}
                    className="field"
                  />
                </Field>

                <Field label="Hourly limit">
                  <input
                    type="number"
                    min="1"
                    value={hourlyLimit}
                    onChange={e => setHourlyLimit(Number(e.target.value))}
                    className="field"
                  />
                </Field>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setCompose(false)}
                  className="px-4 py-2 rounded-lg border"
                >
                  Cancel
                </button>

                <button
                  disabled={busy}
                  onClick={() => void schedule()}
                  className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-50"
                >
                  {busy
                    ? "Scheduling..."
                    : `Schedule ${leads.length} emails`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Statistics card.
function Stat({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
        {icon}
      </div>

      <div>
        <div className="text-sm text-slate-500">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </div>
    </div>
  );
}

// Form field wrapper.
function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}