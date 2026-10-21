import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Space {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo_url?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  email: string | null;
  role: "admin" | "member" | null;
  spaces: Space[];
  currentSpaceId: string | null;
  isLoading: boolean;
  error: string | null;
  sessionChecked: boolean;
  /** True when admin has verified email but hasn't picked a space yet */
  needsSpaceSelection: boolean;
  /** True when user must change their temporary password */
  mustChangePassword: boolean;
  /** Temporarily stored password for the change-password flow */
  _tempPassword: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  /** Admin picks a space to complete login */
  selectSpaceAndComplete: (spaceId: string) => void;
  /** Change password (for must_change_password flow) */
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  /** Load and validate the httpOnly cookie session */
  hydrateSession: () => Promise<boolean>;
  /** Refresh persisted space access from the server */
  refreshSpaces: () => Promise<boolean>;
  logout: () => void;
  switchSpace: (spaceId: string) => void;
  clearError: () => void;
}

interface AuthSessionResponse {
  authenticated?: boolean;
  email?: string;
  spaces?: Space[];
  role?: "admin" | "member";
}

const AUTH_VERIFY_TIMEOUT_MS = 15_000;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      email: null,
      role: null,
      spaces: [],
      currentSpaceId: null,
      isLoading: false,
      error: null,
      sessionChecked: false,
      needsSpaceSelection: false,
      mustChangePassword: false,
      _tempPassword: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          const response = await fetch("/api/auth/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
            signal: AbortSignal.timeout(AUTH_VERIFY_TIMEOUT_MS),
          });

          const data = await response.json();

          if (!response.ok || !data.valid) {
            set({
              isLoading: false,
              sessionChecked: true,
              error: data.error || "Access denied. Contact an admin to get whitelisted.",
            });
            return false;
          }

          const spaces: Space[] = data.spaces || [];

          // Must change password — pause before completing login
          if (data.mustChangePassword) {
            set({
              email: data.email,
              role: data.role,
              spaces,
              currentSpaceId: null,
              isLoading: false,
              error: null,
              sessionChecked: true,
              mustChangePassword: true,
              _tempPassword: password,
              needsSpaceSelection: false,
              isAuthenticated: false,
            });
            return true;
          }

          // Admin with multiple spaces: pause for space selection
          if (data.role === "admin" && spaces.length > 1) {
            set({
              email: data.email,
              role: data.role,
              spaces,
              currentSpaceId: null,
              isLoading: false,
              error: null,
              sessionChecked: true,
              needsSpaceSelection: true,
              isAuthenticated: false,
            });
            return true;
          }

          // Single space (member or admin with 1 space): auto-complete
          const currentSpaceId = spaces.length > 0 ? spaces[0].id : null;

          set({
            isAuthenticated: true,
            email: data.email,
            role: data.role,
            spaces,
            currentSpaceId,
            isLoading: false,
            error: null,
            sessionChecked: true,
            needsSpaceSelection: false,
            mustChangePassword: false,
            _tempPassword: null,
          });

          return true;
        } catch {
          set({
            isLoading: false,
            sessionChecked: true,
            error: "Failed to connect to the server. Please try again.",
          });
          return false;
        }
      },

      selectSpaceAndComplete: (spaceId: string) => {
        const { spaces } = get();
        if (spaces.some((s) => s.id === spaceId)) {
          set({
            isAuthenticated: true,
            currentSpaceId: spaceId,
            sessionChecked: true,
            needsSpaceSelection: false,
          });
        }
      },

      changePassword: async (currentPassword: string, newPassword: string) => {
        const { email } = get();
        if (!email) return false;

        set({ isLoading: true, error: null });

        try {
          const response = await fetch("/api/auth/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword, newPassword }),
          });

          const data = await response.json();

          if (!response.ok) {
            set({
              isLoading: false,
              sessionChecked: true,
              error: data.error || "Failed to change password",
            });
            return false;
          }

          const role = data.role || get().role;
          const spaces: Space[] = data.spaces || get().spaces;
          const responseEmail = data.email || email;

          // Password changed — now complete login
          // Admin with multiple spaces: go to space selection
          if (role === "admin" && spaces.length > 1) {
            set({
              isLoading: false,
              email: responseEmail,
              role,
              spaces,
              sessionChecked: true,
              mustChangePassword: false,
              _tempPassword: null,
              needsSpaceSelection: true,
              error: null,
            });
            return true;
          }

          // Single space: auto-complete
          const currentSpaceId = spaces.length > 0 ? spaces[0].id : null;

          set({
            isAuthenticated: true,
            email: responseEmail,
            role,
            spaces,
            isLoading: false,
            sessionChecked: true,
            mustChangePassword: false,
            _tempPassword: null,
            needsSpaceSelection: false,
            currentSpaceId,
            error: null,
          });

          return true;
        } catch {
          set({
            isLoading: false,
            sessionChecked: true,
            error: "Failed to connect to the server. Please try again.",
          });
          return false;
        }
      },

      hydrateSession: async () => {
        try {
          const response = await fetch("/api/auth/session", {
            cache: "no-store",
          });

          if (!response.ok) {
            set({
              isAuthenticated: false,
              email: null,
              role: null,
              spaces: [],
              currentSpaceId: null,
              isLoading: false,
              error: null,
              sessionChecked: true,
              needsSpaceSelection: false,
              mustChangePassword: false,
              _tempPassword: null,
            });
            return false;
          }

          const data = (await response.json()) as AuthSessionResponse;
          const spaces = data.spaces || [];
          const { currentSpaceId } = get();
          const currentSpaceStillAvailable =
            currentSpaceId && spaces.some((space) => space.id === currentSpaceId);

          set({
            isAuthenticated: true,
            email: data.email || null,
            role: data.role || null,
            spaces,
            currentSpaceId: currentSpaceStillAvailable
              ? currentSpaceId
              : spaces[0]?.id || null,
            isLoading: false,
            error: null,
            sessionChecked: true,
            needsSpaceSelection: false,
            mustChangePassword: false,
            _tempPassword: null,
          });

          return true;
        } catch {
          set({
            isLoading: false,
            sessionChecked: true,
          });
          return false;
        }
      },

      refreshSpaces: async () => {
        const { currentSpaceId, isAuthenticated } = get();

        try {
          const response = await fetch("/api/auth/session", {
            cache: "no-store",
          });

          if (!response.ok) {
            set({
              isAuthenticated: false,
              email: null,
            role: null,
            spaces: [],
            currentSpaceId: null,
            isLoading: false,
            error: null,
            sessionChecked: true,
            needsSpaceSelection: false,
            mustChangePassword: false,
            _tempPassword: null,
          });
            return false;
          }

          const data = (await response.json()) as AuthSessionResponse;
          const spaces = data.spaces || [];
          const currentSpaceStillAvailable =
            currentSpaceId && spaces.some((space) => space.id === currentSpaceId);

          set({
            isAuthenticated: true,
            email: data.email || get().email,
            spaces,
            role: data.role || get().role,
            currentSpaceId: currentSpaceStillAvailable
              ? currentSpaceId
              : isAuthenticated
                ? spaces[0]?.id || null
                : currentSpaceId,
            sessionChecked: true,
          });

          return true;
        } catch {
          return false;
        }
      },

      logout: () => {
        void fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        set({
          isAuthenticated: false,
          email: null,
          role: null,
          spaces: [],
          currentSpaceId: null,
          isLoading: false,
          error: null,
          sessionChecked: true,
          needsSpaceSelection: false,
          mustChangePassword: false,
          _tempPassword: null,
        });
      },

      switchSpace: (spaceId: string) => {
        const { spaces, role } = get();
        if (role === "admin" || spaces.some((s) => s.id === spaceId)) {
          set({ currentSpaceId: spaceId, sessionChecked: true });
        }
      },

      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        // Do not persist session authority. The server cookie is the source of truth.
        email: state.email,
        currentSpaceId: state.currentSpaceId,
      }),
    }
  )
);
