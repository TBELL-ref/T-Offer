/**
 * Supabase Auth for T-Offer — same allowlist + password-setup flow as T-Client.
 */
(function () {
  let client = null;

  function cfg() {
    const c = window.TOfferSupabaseConfig ?? {};
    if (!c.url || !c.anonKey) throw new Error("Supabase 설정이 없습니다.");
    return c;
  }

  function getClient() {
    if (!client) {
      const c = cfg();
      client = window.supabase.createClient(c.url, c.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    }
    return client;
  }

  function normalizeEmail(email) {
    const addr = `${email ?? ""}`.trim().toLowerCase();
    if (!addr.includes("@")) throw new Error("올바른 이메일을 입력하세요.");
    return addr;
  }

  function redirectBase() {
    return window.location.href.split("#")[0];
  }

  function mapAuthError(message) {
    const m = `${message ?? ""}`.toLowerCase();
    if (m.includes("rate limit")) {
      return "메일 발송 한도를 초과했습니다. 1시간 후 다시 시도하거나, 관리자에게 비밀번호 직접 설정을 요청하세요.";
    }
    if (m.includes("only request this after") || m.includes("security purposes")) {
      return "보안상 잠시 후에만 재발송할 수 있습니다. 1~2분 뒤 다시 시도해 주세요.";
    }
    if (m.includes("email address not authorized") || m.includes("invalid email")) {
      return "이메일 형식이 올바르지 않거나 발송 설정(SMTP)을 확인해야 합니다.";
    }
    return message;
  }

  async function checkAllowed(email) {
    const addr = normalizeEmail(email);
    const { url, anonKey } = cfg();
    const res = await fetch(`${url}/rest/v1/rpc/check_email_allowed`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ addr })
    });
    if (!res.ok) throw new Error("허용 이메일 확인 실패");
    return !!(await res.json());
  }

  async function assertAllowedEmail(email) {
    const ok = await checkAllowed(email);
    if (!ok) throw new Error("허용되지 않은 이메일입니다. 관리자에게 등록을 요청하세요.");
  }

  async function signIn(email, password) {
    const addr = normalizeEmail(email);
    const pwd = `${password ?? ""}`;
    if (pwd.length < 8) throw new Error("비밀번호는 8자 이상이어야 합니다.");
    await assertAllowedEmail(addr);
    const { error } = await getClient().auth.signInWithPassword({ email: addr, password: pwd });
    if (error) {
      if (/invalid login credentials/i.test(error.message)) {
        throw new Error(
          "이메일 또는 비밀번호가 올바르지 않습니다. 처음이면 「설정 메일 받기」로 비밀번호를 설정하세요."
        );
      }
      throw new Error(mapAuthError(error.message));
    }
    return true;
  }

  async function sendPasswordSetupEmail(email) {
    const addr = normalizeEmail(email);
    await assertAllowedEmail(addr);
    const { error } = await getClient().auth.resetPasswordForEmail(addr, {
      redirectTo: redirectBase()
    });
    if (error) throw new Error(mapAuthError(error.message));
    return true;
  }

  async function updatePassword(password) {
    const pwd = `${password ?? ""}`;
    if (pwd.length < 8) throw new Error("비밀번호는 8자 이상이어야 합니다.");
    const { error } = await getClient().auth.updateUser({ password: pwd });
    if (error) throw new Error(error.message);
    return true;
  }

  async function signOut() {
    await getClient().auth.signOut();
  }

  async function getSession() {
    const { data, error } = await getClient().auth.getSession();
    if (error) throw new Error(error.message);
    return data.session;
  }

  window.TOfferAuth = {
    signIn,
    signInWithPassword: signIn,
    sendPasswordSetupEmail,
    updatePassword,
    signOut,
    getSession,
    requireSession: async () => {
      const session = await getSession();
      if (!session?.user?.email) throw new Error("로그인이 필요합니다.");
      return session;
    },
    getUserEmail: async () => (await getSession())?.user?.email?.toLowerCase() ?? "",
    getAccessToken: async () => (await getSession())?.access_token ?? "",
    onAuthStateChange: (cb) => getClient().auth.onAuthStateChange((e, s) => cb(e, s))
  };
})();
