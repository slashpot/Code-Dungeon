using System;
using System.Collections.Concurrent;
using System.Threading;
using Jint;
using Jint.Runtime;
using Jint.Runtime.Debugger;

namespace CodingPunk;

/// <summary>
/// 在背景執行緒跑玩家 JS(Jint)。
/// stepped 模式下每個 statement 停在閘門前,由主執行緒(Godot)呼叫
/// AdvanceOneStatement() 放行——主執行緒永遠不會被玩家腳本卡住,
/// 所以無窮迴圈在架構上就凍不死遊戲。
/// 防呆兩層:MaxStatements 硬上限 + Stop() 走 CancellationToken
/// (Jint 丟 ExecutionCanceledException,玩家 JS 的 try/catch 吃不掉)。
/// 執行緒約定:主執行緒只讀 CurrentLine/State、呼叫 Advance/Stop、
/// 從 TryDequeueEvent 收事件;Godot API 一律不進背景執行緒。
/// </summary>
public sealed class JintRunner : IDisposable
{
    public enum RunState { Running, Done, Stopped, LimitExceeded, Error }

    public const int DefaultMaxStatements = 200_000;

    private readonly ConcurrentQueue<string> _events = new();
    private readonly SemaphoreSlim _gate = new(0, 1);
    private readonly CancellationTokenSource _cts = new();
    private readonly Thread _thread;
    private readonly bool _stepped;
    private readonly int _maxStatements;

    private volatile int _currentLine;
    private volatile bool _pausedAtStatement;
    private volatile RunState _state = RunState.Running;
    private volatile string? _error;

    /// <summary>目前停在的行號(1-based;0 = 尚未執行到任何 statement)。</summary>
    public int CurrentLine => _currentLine;

    /// <summary>true = 背景執行緒停在閘門前,等 AdvanceOneStatement()。</summary>
    public bool PausedAtStatement => _pausedAtStatement;

    public RunState State => _state;
    public bool IsFinished => _state != RunState.Running;
    public string? Error => _error;

    public JintRunner(string code, bool stepped = true, int maxStatements = DefaultMaxStatements)
    {
        _stepped = stepped;
        _maxStatements = maxStatements;
        _thread = new Thread(() => RunScript(code)) { IsBackground = true, Name = "JintRunner" };
        _thread.Start();
    }

    /// <summary>事件格式 "kind|text",kind ∈ act/log/sys。</summary>
    public bool TryDequeueEvent(out string evt) => _events.TryDequeue(out evt!);

    /// <summary>主執行緒:放行一個 statement(僅 stepped 模式有作用)。</summary>
    public void AdvanceOneStatement()
    {
        if (!_pausedAtStatement) return;
        _pausedAtStatement = false;
        _gate.Release();
    }

    /// <summary>主執行緒:強制停止(玩家按停止鈕)。</summary>
    public void Stop() => _cts.Cancel();

    public void Dispose()
    {
        _cts.Cancel();
        if (!_thread.Join(1000)) return; // 收不掉就留給 process 結束時回收(IsBackground)
        _gate.Dispose();
        _cts.Dispose();
    }

    private void RunScript(string code)
    {
        try
        {
            var engine = new Engine(options =>
            {
                options.CancellationToken(_cts.Token); // 每個 statement 檢查
                options.MaxStatements(_maxStatements); // 無窮迴圈硬上限
                if (_stepped)
                {
                    options.DebugMode();
                    options.InitialStepMode(StepMode.Into);
                    options.DebuggerStatementHandling(DebuggerStatementHandling.Ignore);
                }
            });
            if (_stepped)
                engine.Debugger.Step += OnStep;

            // 行動函式委派:玩家 JS 直接呼叫 C#——正式版 API v0 接線就是這個形狀
            engine.SetValue("move", new Action<string>(dir => _events.Enqueue($"act|move(\"{dir}\")")));
            engine.SetValue("attack", new Action(() => _events.Enqueue("act|attack()")));
            engine.SetValue("log", new Action<object?>(msg => _events.Enqueue($"log|{msg}")));

            engine.Execute(code);
            _state = RunState.Done;
            _events.Enqueue("sys|✔ 腳本執行完畢");
        }
        catch (ExecutionCanceledException)
        {
            _state = RunState.Stopped;
            _events.Enqueue("sys|■ 已手動停止");
        }
        catch (OperationCanceledException) // Stop() 打斷閘門等待
        {
            _state = RunState.Stopped;
            _events.Enqueue("sys|■ 已手動停止");
        }
        catch (StatementsCountOverflowException)
        {
            _state = RunState.LimitExceeded;
            _events.Enqueue($"sys|⚠ 超過 {_maxStatements:N0} statement 上限,強制終止(無窮迴圈防呆)");
        }
        catch (JavaScriptException jsEx)
        {
            _state = RunState.Error;
            _error = jsEx.Message;
            _events.Enqueue($"sys|✘ 腳本錯誤(行 {jsEx.Location.Start.Line}):{jsEx.Message}");
        }
        catch (Exception ex)
        {
            _state = RunState.Error;
            _error = ex.Message;
            _events.Enqueue($"sys|✘ {ex.GetType().Name}:{ex.Message}");
        }
        finally
        {
            _pausedAtStatement = false;
        }
    }

    private StepMode OnStep(object sender, DebugInformation info)
    {
        _currentLine = info.Location.Start.Line;
        _pausedAtStatement = true;
        _gate.Wait(_cts.Token); // 等主執行緒放行;Stop() 會打斷
        return StepMode.Into;
    }
}
