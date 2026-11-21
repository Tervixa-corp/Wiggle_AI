// Tervixa Wiggle desktop launcher.
//
// The product runtime is the Node gateway in app/server. This launcher owns the
// desktop experience around it: it starts the bundled Node process in a hidden
// window, then hosts the workbench in an embedded WebView2 control. Closing the
// window stops the gateway.
//
// The window never waits on the gateway to paint. It draws its own shell first
// (plain HTML, no server involved) and swaps in the workbench when the runtime
// answers, so launch feels like an application opening rather than a browser
// waiting for a port.
//
// Compiled with the .NET Framework 4.x csc, so this file is deliberately C# 5:
// no string interpolation, no null-conditional operators, no expression bodies.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TervixaWiggle
{
    internal static class AppPaths
    {
        public static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
        public static readonly string NodeExe = Path.Combine(Root, Path.Combine("node", "node.exe"));
        public static readonly string ServerScript = Path.Combine(Root, Path.Combine(Path.Combine("app", "server"), "main.mjs"));
        public static readonly string LocalData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tervixa Wiggle");
        public static readonly string PidFile = Path.Combine(LocalData, "server.pid");
        public static readonly string LogFile = Path.Combine(LocalData, "server.log");
        public static readonly string WorkspaceFile = Path.Combine(LocalData, "workspace.txt");
        public static readonly string WebViewData = Path.Combine(LocalData, "WebView2");

        public static void Ensure()
        {
            Directory.CreateDirectory(LocalData);
            Directory.CreateDirectory(WebViewData);
        }
    }

    internal static class Gateway
    {
        public const int Port = 4317;
        private static Process _process;

        public static bool IsRunning()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/api/status");
                req.Timeout = 1200;
                req.ReadWriteTimeout = 1200;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return (int)res.StatusCode == 200;
                }
            }
            catch
            {
                return false;
            }
        }

        public static async Task<bool> StartAsync(string workspace)
        {
            if (IsRunning()) return true;
            Stop();

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = AppPaths.NodeExe;
            psi.Arguments = "\"" + AppPaths.ServerScript + "\"";
            psi.WorkingDirectory = workspace;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.EnvironmentVariables["WIGGLE_WORKSPACE"] = workspace;
            psi.EnvironmentVariables["WIGGLE_PORT"] = Port.ToString();
            psi.EnvironmentVariables["NODE_ENV"] = "production";
            psi.EnvironmentVariables.Remove("NODE_OPTIONS");

            try
            {
                _process = Process.Start(psi);
            }
            catch (Exception ex)
            {
                Log("Failed to start the bundled runtime: " + ex.Message);
                return false;
            }
            if (_process == null) return false;

            _process.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data != null) Log(e.Data);
            };
            _process.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data != null) Log(e.Data);
            };
            _process.BeginOutputReadLine();
            _process.BeginErrorReadLine();

            try
            {
                File.WriteAllText(AppPaths.PidFile, _process.Id.ToString());
            }
            catch
            {
            }

            for (int i = 0; i < 120; i++)
            {
                await Task.Delay(250);
                bool exited;
                try
                {
                    exited = _process.HasExited;
                }
                catch
                {
                    exited = true;
                }
                if (exited)
                {
                    Log("The runtime exited before it started listening.");
                    return false;
                }
                if (IsRunning()) return true;
            }
            Log("Timed out waiting for http://127.0.0.1:" + Port + "/api/status");
            return false;
        }

        public static void Stop()
        {
            int pid = 0;
            try
            {
                if (File.Exists(AppPaths.PidFile))
                {
                    int.TryParse(File.ReadAllText(AppPaths.PidFile).Trim(), out pid);
                }
            }
            catch
            {
            }

            if (pid > 0 && IsNodeProcess(pid)) KillTree(pid);

            if (_process != null)
            {
                try
                {
                    if (!_process.HasExited) KillTree(_process.Id);
                }
                catch
                {
                }
                try
                {
                    _process.Dispose();
                }
                catch
                {
                }
                _process = null;
            }

            try
            {
                if (File.Exists(AppPaths.PidFile)) File.Delete(AppPaths.PidFile);
            }
            catch
            {
            }
        }

        private static bool IsNodeProcess(int pid)
        {
            try
            {
                using (Process p = Process.GetProcessById(pid))
                {
                    return string.Equals(p.ProcessName, "node", StringComparison.OrdinalIgnoreCase);
                }
            }
            catch
            {
                return false;
            }
        }

        public static void KillTree(int pid)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("taskkill", "/PID " + pid + " /T /F");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (Process p = Process.Start(psi))
                {
                    if (p != null) p.WaitForExit(5000);
                }
            }
            catch
            {
            }
        }

        public static void Log(string line)
        {
            try
            {
                File.AppendAllText(AppPaths.LogFile,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line + Environment.NewLine);
            }
            catch
            {
            }
        }
    }

    internal sealed class MainWindow : Form
    {
        // Win32: the window has no non-client frame, so the application paints its
        // own title bar. Dragging and resizing are delegated to the system so that
        // Aero snap, double-click maximise and the resize loop behave natively.
        private const int WM_NCLBUTTONDOWN = 0x00A1;
        private const int HTCAPTION = 2;
        private const int HTLEFT = 10;
        private const int HTRIGHT = 11;
        private const int HTTOP = 12;
        private const int HTTOPLEFT = 13;
        private const int HTTOPRIGHT = 14;
        private const int HTBOTTOM = 15;
        private const int HTBOTTOMLEFT = 16;
        private const int HTBOTTOMRIGHT = 17;

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MINMAXINFO
        {
            public POINT ptReserved;
            public POINT ptMaxSize;
            public POINT ptMaxPosition;
            public POINT ptMinTrackSize;
            public POINT ptMaxTrackSize;
        }

        private const int WM_GETMINMAXINFO = 0x0024;

        private readonly WebView2 _view;
        private readonly Panel[] _grips = new Panel[8];
        private string _workspace;
        private bool _busy;

        public MainWindow()
        {
            Text = "Tervixa Wiggle";
            FormBorderStyle = FormBorderStyle.None;
            Width = 1440;
            Height = 900;
            MinimumSize = new Size(960, 620);
            BackColor = Color.FromArgb(10, 10, 10);
            StartPosition = FormStartPosition.CenterScreen;
            KeyPreview = true;
            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
            }

            _view = new WebView2();
            _view.Dock = DockStyle.Fill;
            try
            {
                _view.DefaultBackgroundColor = Color.FromArgb(10, 10, 10);
            }
            catch
            {
            }
            Controls.Add(_view);

            BuildGrips();

            Shown += OnShown;
            Resize += delegate { LayoutGrips(); };
        }

        // Two pixel edge strips plus corner squares. They sit above the WebView and
        // hand the press straight to the OS resize loop.
        private void BuildGrips()
        {
            _grips[0] = MakeGrip(Cursors.SizeWE, HTLEFT);
            _grips[1] = MakeGrip(Cursors.SizeWE, HTRIGHT);
            _grips[2] = MakeGrip(Cursors.SizeNS, HTTOP);
            _grips[3] = MakeGrip(Cursors.SizeNS, HTBOTTOM);
            _grips[4] = MakeGrip(Cursors.SizeNWSE, HTTOPLEFT);
            _grips[5] = MakeGrip(Cursors.SizeNESW, HTTOPRIGHT);
            _grips[6] = MakeGrip(Cursors.SizeNESW, HTBOTTOMLEFT);
            _grips[7] = MakeGrip(Cursors.SizeNWSE, HTBOTTOMRIGHT);
            LayoutGrips();
        }

        private Panel MakeGrip(Cursor cursor, int hit)
        {
            Panel grip = new Panel();
            grip.BackColor = Color.FromArgb(10, 10, 10);
            grip.Cursor = cursor;
            grip.MouseDown += delegate { BeginSystemMove(hit); };
            Controls.Add(grip);
            grip.BringToFront();
            return grip;
        }

        private void LayoutGrips()
        {
            if (_grips[0] == null) return;
            int w = ClientSize.Width;
            int h = ClientSize.Height;
            const int edge = 5;
            const int corner = 10;

            _grips[0].SetBounds(0, corner, edge, Math.Max(0, h - 2 * corner));
            _grips[1].SetBounds(w - edge, corner, edge, Math.Max(0, h - 2 * corner));
            _grips[2].SetBounds(corner, 0, Math.Max(0, w - 2 * corner), 3);
            _grips[3].SetBounds(corner, h - edge, Math.Max(0, w - 2 * corner), edge);

            _grips[4].SetBounds(0, 0, corner, corner);
            _grips[5].SetBounds(w - corner, 0, corner, corner);
            _grips[6].SetBounds(0, h - corner, corner, corner);
            _grips[7].SetBounds(w - corner, h - corner, corner, corner);
        }

        private void BeginSystemMove(int hit)
        {
            ReleaseCapture();
            SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)hit, IntPtr.Zero);
        }

        private void ToggleMaximize()
        {
            if (WindowState == FormWindowState.Maximized)
            {
                WindowState = FormWindowState.Normal;
                return;
            }
            Screen screen = Screen.FromControl(this);
            MaximizedBounds = screen.WorkingArea;
            WindowState = FormWindowState.Maximized;
        }

        // A borderless window would otherwise maximise over the taskbar.
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_GETMINMAXINFO)
            {
                Screen screen = Screen.FromHandle(Handle);
                Rectangle work = screen.WorkingArea;
                Rectangle monitor = screen.Bounds;
                MINMAXINFO info = (MINMAXINFO)Marshal.PtrToStructure(m.LParam, typeof(MINMAXINFO));
                info.ptMaxPosition.x = work.Left - monitor.Left;
                info.ptMaxPosition.y = work.Top - monitor.Top;
                info.ptMaxSize.x = work.Width;
                info.ptMaxSize.y = work.Height;
                info.ptMaxTrackSize.x = monitor.Width;
                info.ptMaxTrackSize.y = monitor.Height;
                Marshal.StructureToPtr(info, m.LParam, true);
                return;
            }
            base.WndProc(ref m);
        }

        // Windows 11 draws the frame; these attributes keep the shadow/corners dark
        // and match the workbench surface so there is never a white seam.
        private void ApplyWindowAppearance()
        {
            try
            {
                int dark = 1;
                DwmSetWindowAttribute(Handle, 20, ref dark, 4);
                DwmSetWindowAttribute(Handle, 19, ref dark, 4);
                int caption = 0x000A0A0A;
                DwmSetWindowAttribute(Handle, 35, ref caption, 4);
                int text = 0x00F2F2F2;
                DwmSetWindowAttribute(Handle, 36, ref text, 4);
                int corner = 2;
                DwmSetWindowAttribute(Handle, 33, ref corner, 4);
            }
            catch
            {
            }
        }

        private void HandleMessage(string message)
        {
            if (string.IsNullOrEmpty(message)) return;
            if (string.Equals(message, "retry", StringComparison.Ordinal))
            {
                Retry();
                return;
            }
            if (string.Equals(message, "shell:drag", StringComparison.Ordinal))
            {
                BeginSystemMove(HTCAPTION);
                return;
            }
            if (string.Equals(message, "shell:minimize", StringComparison.Ordinal))
            {
                WindowState = FormWindowState.Minimized;
                return;
            }
            if (string.Equals(message, "shell:maximize", StringComparison.Ordinal))
            {
                ToggleMaximize();
                return;
            }
            if (string.Equals(message, "shell:close", StringComparison.Ordinal))
            {
                Close();
                return;
            }
            if (string.Equals(message, "shell:reload", StringComparison.Ordinal))
            {
                Reload();
                return;
            }
            if (string.Equals(message, "shell:change-workspace", StringComparison.Ordinal))
            {
                ChangeWorkspace();
                return;
            }
            if (string.Equals(message, "shell:open-settings", StringComparison.Ordinal))
            {
                OpenFolder(AppPaths.LocalData);
                return;
            }
            if (string.Equals(message, "shell:open-workspace", StringComparison.Ordinal))
            {
                OpenFolder(_workspace);
            }
        }

        private async void OnShown(object sender, EventArgs e)
        {
            AppPaths.Ensure();
            ApplyWindowAppearance();
            _workspace = ResolveWorkspace();

            CoreWebView2 core = null;
            string failure = null;
            try
            {
                CoreWebView2Environment env =
                    await CoreWebView2Environment.CreateAsync(null, AppPaths.WebViewData);
                await _view.EnsureCoreWebView2Async(env);
                core = _view.CoreWebView2;
            }
            catch (Exception ex)
            {
                failure = ex.Message;
            }

            if (core == null)
            {
                Gateway.Log("The embedded window is unavailable: " + (failure == null ? "unknown" : failure));
                await Gateway.StartAsync(_workspace);
                MessageBox.Show(this,
                    "Tervixa Wiggle could not create its application window.\n\n" +
                    "Install the Microsoft Edge WebView2 runtime and start the app again.",
                    "Tervixa Wiggle", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }

            ConfigureCore(core);

            // Paint the application shell before touching the runtime.
            ShowSplash();
            await OpenWorkbenchAsync();
            await RunShellSelfTestAsync(core);
        }

        // Diagnostics hook: proves the page -> WebView2 -> launcher message path
        // without any synthetic mouse input. Enabled only by an environment
        // variable, so it is inert in normal use.
        private async Task RunShellSelfTestAsync(CoreWebView2 core)
        {
            string command = Environment.GetEnvironmentVariable("WIGGLE_SHELL_SELFTEST");
            if (string.IsNullOrEmpty(command)) return;
            try
            {
                await Task.Delay(3000);
                string script;
                if (command.StartsWith("eval:", StringComparison.Ordinal))
                {
                    script = command.Substring(5);
                    await core.ExecuteScriptAsync(script);
                    await Task.Delay(1200);
                    Gateway.Log("selftest eval state=" + WindowState + " bounds=" + Bounds.ToString());
                    return;
                }
                script = "chrome.webview.postMessage('shell:" + command + "')";
                await core.ExecuteScriptAsync(script);
                await Task.Delay(1500);
                Gateway.Log("selftest shell:" + command + " state=" + WindowState + " bounds=" + Bounds.ToString());
            }
            catch (Exception ex)
            {
                Gateway.Log("selftest failed: " + ex.Message);
            }
        }

        // The hosted page is an application, not a browser tab. Every browser
        // affordance is off: no swipe-to-go-back arrows on a trackpad, no
        // right-click "Reload / Save as / Inspect" menu, no Ctrl+R or F5, no
        // zooming, no autofill/password bubbles and no built-in error page.
        private void ConfigureCore(CoreWebView2 core)
        {
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsBuiltInErrorPageEnabled = false;
            try
            {
                // Two-finger horizontal swipe over the window must scroll the
                // page, never navigate its history.
                core.Settings.IsSwipeNavigationEnabled = false;
            }
            catch (Exception)
            {
            }
            try
            {
                core.Settings.IsGeneralAutofillEnabled = false;
            }
            catch (Exception)
            {
            }
            try
            {
                core.Settings.IsPasswordAutosaveEnabled = false;
            }
            catch (Exception)
            {
            }

            core.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs a)
            {
                a.Handled = true;
                OpenExternal(a.Uri);
            };

            core.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs a)
            {
                Uri uri;
                if (Uri.TryCreate(a.Uri, UriKind.Absolute, out uri) &&
                    !string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase))
                {
                    a.Cancel = true;
                    OpenExternal(a.Uri);
                }
            };

            core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs a)
            {
                string message = null;
                try
                {
                    message = a.TryGetWebMessageAsString();
                }
                catch
                {
                }
                HandleMessage(message);
            };
        }

        private async Task OpenWorkbenchAsync()
        {
            if (_busy) return;
            _busy = true;
            try
            {
                bool ok = await Gateway.StartAsync(_workspace);
                if (!ok)
                {
                    ShowFailure();
                    return;
                }
                _view.Source = new Uri(WorkbenchUrl());
            }
            finally
            {
                _busy = false;
            }
        }

        private async void Retry()
        {
            if (_busy) return;
            ShowSplash();
            await OpenWorkbenchAsync();
        }

        private string WorkbenchUrl()
        {
            return "http://127.0.0.1:" + Gateway.Port + "/";
        }

        private void ShowSplash()
        {
            _view.NavigateToString(SplashHtml());
        }

        private void ShowFailure()
        {
            _view.NavigateToString(FailureHtml());
        }

        private string WorkspaceLabel()
        {
            try
            {
                string name = Path.GetFileName(_workspace.TrimEnd(Path.DirectorySeparatorChar));
                if (!string.IsNullOrEmpty(name)) return name;
            }
            catch
            {
            }
            return "workspace";
        }

        private static string Escape(string value)
        {
            if (value == null) return string.Empty;
            return value
                .Replace("&", "&amp;")
                .Replace("<", "&lt;")
                .Replace(">", "&gt;")
                .Replace("\"", "&quot;");
        }

        private static string Shell(string body)
        {
            StringBuilder html = new StringBuilder();
            html.Append("<!doctype html><html><head><meta charset=\"utf-8\">");
            html.Append("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'\">");
            html.Append("<style>");
            html.Append("*{box-sizing:border-box}");
            html.Append("html,body{margin:0;height:100%;background:#0A0A0A;color:#E8E8E8;");
            html.Append("font-family:'Segoe UI',system-ui,-apple-system,sans-serif;overflow:hidden}");
            html.Append(".win{display:flex;flex-direction:column;height:100%}");
            html.Append(".tbar{height:38px;flex:none;display:flex;align-items:center;gap:9px;padding-left:14px;");
            html.Append("border-bottom:1px solid #161619;background:#0A0A0A;user-select:none}");
            html.Append(".tbmark{width:18px;height:18px;display:grid;place-items:center;border:1px solid #2B2B31;");
            html.Append("border-radius:4px;font-size:8px;font-weight:700;letter-spacing:.02em;color:#D8D8DC}");
            html.Append(".tbname{font-size:12.5px;font-weight:600;color:#EDEDEF;letter-spacing:-.01em}");
            html.Append(".tbsub{font-size:10.5px;color:#4B4B53}");
            html.Append(".tbspace{flex:1}");
            html.Append(".tbbtns{display:flex}");
            html.Append(".tbtn{width:46px;height:38px;display:grid;place-items:center;border:0;background:transparent;");
            html.Append("color:#8A8A92;cursor:default;padding:0}");
            html.Append(".tbtn:hover{background:#16161A;color:#EDEDEF}");
            html.Append(".tbtn.close:hover{background:#C42B1C;color:#FFFFFF}");
            html.Append(".shell{display:flex;flex:1;min-height:0}");
            html.Append(".side{width:260px;background:#0D0D0F;border-right:1px solid #1A1A1D;padding:20px 16px}");
            html.Append(".brand{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7C7C85;font-weight:600}");
            html.Append(".brand small{display:block;font-size:10px;letter-spacing:.06em;color:#45454C;margin-top:7px;text-transform:none;font-weight:400}");
            html.Append(".bar{height:7px;border-radius:4px;background:#151518;margin-top:13px}");
            html.Append(".w1{width:84%}.w2{width:62%}.w3{width:74%}.w4{width:48%}.gap{height:22px}");
            html.Append(".main{flex:1;display:flex;flex-direction:column;min-width:0}");
            html.Append(".top{height:46px;border-bottom:1px solid #1A1A1D;display:flex;align-items:center;");
            html.Append("padding:0 20px;color:#55555C;font-size:11px;letter-spacing:.12em;text-transform:uppercase}");
            html.Append(".body{flex:1;display:flex;align-items:center;justify-content:center;padding:32px}");
            html.Append(".note{text-align:center;max-width:360px}");
            html.Append(".note b{display:block;color:#DDDDE1;font-weight:500;font-size:14px;margin-bottom:7px;letter-spacing:.01em}");
            html.Append(".note span{color:#5C5C63;font-size:12.5px;line-height:1.6}");
            html.Append(".pulse{animation:pulse 1.5s ease-in-out infinite}");
            html.Append("@keyframes pulse{0%,100%{opacity:.3}50%{opacity:.85}}");
            html.Append(".btn{display:inline-block;margin-top:20px;padding:9px 18px;border:1px solid #2A2A2F;border-radius:5px;");
            html.Append("background:#131316;color:#E4E4E8;font-size:12px;letter-spacing:.03em;cursor:pointer}");
            html.Append(".btn:hover{background:#191920;border-color:#3A3A42}");
            html.Append(".path{margin-top:14px;color:#45454C;font-size:11px;word-break:break-all}");
            html.Append("</style></head><body><div class=\"win\">");

            html.Append("<div class=\"tbar\" id=\"dragbar\">");
            html.Append("<div class=\"tbmark\">TW</div>");
            html.Append("<div class=\"tbname\">Tervixa Wiggle</div>");
            html.Append("<div class=\"tbsub\">Developed by Tervixa Corporation</div>");
            html.Append("<div class=\"tbspace\"></div>");
            html.Append("<div class=\"tbbtns\">");
            html.Append("<button class=\"tbtn\" id=\"tb-min\" title=\"Minimise\" aria-label=\"Minimise\">");
            html.Append("<svg width=\"10\" height=\"10\" viewBox=\"0 0 10 10\"><path d=\"M0 5h10\" stroke=\"currentColor\" stroke-width=\"1\"/></svg></button>");
            html.Append("<button class=\"tbtn\" id=\"tb-max\" title=\"Maximise\" aria-label=\"Maximise\">");
            html.Append("<svg width=\"10\" height=\"10\" viewBox=\"0 0 10 10\"><rect x=\"0.5\" y=\"0.5\" width=\"9\" height=\"9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\"/></svg></button>");
            html.Append("<button class=\"tbtn close\" id=\"tb-close\" title=\"Close\" aria-label=\"Close\">");
            html.Append("<svg width=\"10\" height=\"10\" viewBox=\"0 0 10 10\"><path d=\"M0 0l10 10M10 0L0 10\" stroke=\"currentColor\" stroke-width=\"1\"/></svg></button>");
            html.Append("</div></div>");

            html.Append("<div class=\"shell\"><div class=\"side\"><div class=\"brand\">Workspace");
            html.Append("<small>Local-first agent runtime</small></div>");
            html.Append("<div class=\"bar w1 pulse\"></div><div class=\"bar w2\"></div>");
            html.Append("<div class=\"bar w3\"></div><div class=\"bar w4\"></div>");
            html.Append("</div><div class=\"main\">");
            html.Append(body);
            html.Append("</div></div></div>");

            html.Append("<script>(function(){function post(m){try{chrome.webview.postMessage(m)}catch(e){}}");
            html.Append("var bar=document.getElementById('dragbar');");
            html.Append("bar.addEventListener('mousedown',function(e){if(e.target.closest('.tbtn'))return;post('shell:drag')});");
            html.Append("bar.addEventListener('dblclick',function(e){if(e.target.closest('.tbtn'))return;post('shell:maximize')});");
            html.Append("document.getElementById('tb-min').addEventListener('click',function(){post('shell:minimize')});");
            html.Append("document.getElementById('tb-max').addEventListener('click',function(){post('shell:maximize')});");
            html.Append("document.getElementById('tb-close').addEventListener('click',function(){post('shell:close')});");
            html.Append("var retry=document.getElementById('retry');");
            html.Append("if(retry)retry.addEventListener('click',function(){post('retry')});");
            html.Append("})();</script>");
            html.Append("</body></html>");
            return html.ToString();
        }

        private string SplashHtml()
        {
            StringBuilder body = new StringBuilder();
            body.Append("<div class=\"top\">").Append(Escape(WorkspaceLabel())).Append("</div>");
            body.Append("<div class=\"body\"><div class=\"note\">");
            body.Append("<b>Opening your workspace</b>");
            body.Append("<span>Preparing the workbench and your project files.</span>");
            body.Append("</div></div>");
            return Shell(body.ToString());
        }

        private string FailureHtml()
        {
            StringBuilder body = new StringBuilder();
            body.Append("<div class=\"top\">").Append(Escape(WorkspaceLabel())).Append("</div>");
            body.Append("<div class=\"body\"><div class=\"note\">");
            body.Append("<b>Tervixa Wiggle could not open</b>");
            body.Append("<span>The local runtime did not respond. This is usually a locked workspace folder or a blocked port.</span>");
            body.Append("<div><button class=\"btn\" id=\"retry\">Try again</button></div>");
            body.Append("<div class=\"path\">").Append(Escape(AppPaths.LogFile)).Append("</div>");
            body.Append("</div></div>");
            return Shell(body.ToString());
        }

        private static string ResolveWorkspace()
        {
            string saved = null;
            try
            {
                if (File.Exists(AppPaths.WorkspaceFile))
                {
                    saved = File.ReadAllText(AppPaths.WorkspaceFile).Trim();
                }
            }
            catch
            {
            }
            if (!string.IsNullOrEmpty(saved) && Directory.Exists(saved)) return saved;

            // First run: open straight into a dedicated folder so the app is usable
            // immediately. File > Change workspace moves it later.
            string fallback = DefaultWorkspace();
            try
            {
                Directory.CreateDirectory(fallback);
            }
            catch
            {
            }
            SaveWorkspace(fallback);
            return fallback;
        }

        private static string DefaultWorkspace()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Tervixa Wiggle Workspace");
        }

        private static void SaveWorkspace(string path)
        {
            try
            {
                Directory.CreateDirectory(AppPaths.LocalData);
                File.WriteAllText(AppPaths.WorkspaceFile, path);
            }
            catch
            {
            }
        }

        private async void ChangeWorkspace()
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "Choose the project folder Tervixa Wiggle should work in.";
                dialog.SelectedPath = _workspace;
                dialog.ShowNewFolderButton = true;
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                if (!Directory.Exists(dialog.SelectedPath)) return;

                SaveWorkspace(dialog.SelectedPath);
                _workspace = dialog.SelectedPath;
                Gateway.Stop();
                ShowSplash();
                await OpenWorkbenchAsync();
            }
        }

        private void Reload()
        {
            try
            {
                _view.CoreWebView2.Reload();
            }
            catch
            {
            }
        }

        private void Zoom(double delta)
        {
            try
            {
                SetZoom(_view.ZoomFactor + delta);
            }
            catch
            {
            }
        }

        private void SetZoom(double factor)
        {
            try
            {
                double next = Math.Max(0.5, Math.Min(2.5, factor));
                _view.ZoomFactor = next;
            }
            catch
            {
            }
        }

        private void About()
        {
            MessageBox.Show(this,
                "Tervixa Wiggle 1.0.0" + Environment.NewLine +
                "Local-first AI software engineering workbench." + Environment.NewLine + Environment.NewLine +
                "Developed by Tervixa Corporation." + Environment.NewLine + Environment.NewLine +
                "Workspace: " + _workspace + Environment.NewLine +
                "Settings: " + Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".wiggle"),
                "About Tervixa Wiggle", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private static void OpenFolder(string path)
        {
            if (string.IsNullOrEmpty(path)) return;
            try
            {
                Directory.CreateDirectory(path);
                Process.Start(new ProcessStartInfo("explorer.exe", "\"" + path + "\"") { UseShellExecute = true });
            }
            catch
            {
            }
        }

        private static void OpenExternal(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch
            {
            }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            bool created;
            using (Mutex mutex = new Mutex(true, "TervixaWiggleDesktopShell", out created))
            {
                if (!created)
                {
                    MessageBox.Show(
                        "Tervixa Wiggle is already running.",
                        "Tervixa Wiggle", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                // Belt and braces for older WebView2 runtimes: Chromium's own
                // overscroll history navigation is disabled before the
                // environment is created, so a horizontal trackpad swipe can
                // never raise the back/forward overlay.
                if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")))
                {
                    Environment.SetEnvironmentVariable(
                        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                        "--disable-features=OverscrollHistoryNavigation");
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                AppPaths.Ensure();

                try
                {
                    Application.Run(new MainWindow());
                }
                finally
                {
                    Gateway.Stop();
                }
            }
        }
    }
}
