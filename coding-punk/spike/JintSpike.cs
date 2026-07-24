using Godot;
using System.Collections.Generic;
using System.Linq;

namespace CodingPunk;

/// <summary>
/// M0 spike 場景:左邊 CodeEdit(JS 高亮+行號+目前行反白),右邊動作 log。
/// 執行流程:JintRunner 在背景執行緒逐 statement 暫停,這裡每 StepDelaySec
/// 放行一步並反白該行;事件佇列逐幀倒進 log。
/// headless 模式(--headless)自動跑兩階段驗收:
///   phase 1 = stepped 範例腳本(委派+逐行), phase 2 = while(true) 全速(MaxStatements)。
/// </summary>
public partial class JintSpike : Control
{
	private const double StepDelaySec = 0.10;
	private static readonly Color LineHighlight = new(1f, 0.85f, 0.3f, 0.22f);
	private static readonly Color LineClear = new(0, 0, 0, 0);

	private const string SampleScript =
"""
// M0 spike:假想勇者腳本
// move()/attack()/log() 是 C# 委派,由 Jint 呼叫
var path = ["up", "up", "right"];
for (var i = 0; i < path.length; i++) {
  move(path[i]);
}
attack();
const msg = `ES6 也通(const + template string)`;
log(msg);
""";

	private const string LoopScript =
"""
// 無窮迴圈防呆測試:
// 逐行模式下遊戲照跑不誤,隨時可按「停止」;
// 全速模式另有 MaxStatements 硬上限攔截
var n = 0;
while (true) {
  n = n + 1;
}
""";

	private CodeEdit _code = null!;
	private RichTextLabel _log = null!;
	private Button _runBtn = null!;
	private Button _stopBtn = null!;
	private Label _status = null!;

	private JintRunner? _runner;
	private double _stepTimer;
	private int _highlightedLine = -1;

	private bool _headless;
	private int _headlessPhase;
	private readonly List<string> _headlessEvents = new();
	private readonly HashSet<int> _headlessLines = new();

	public override void _Ready()
	{
		_code = GetNode<CodeEdit>("Layout/Left/Code");
		_log = GetNode<RichTextLabel>("Layout/Right/Log");
		_runBtn = GetNode<Button>("Layout/Left/Toolbar/RunButton");
		_stopBtn = GetNode<Button>("Layout/Left/Toolbar/StopButton");
		_status = GetNode<Label>("Layout/Left/Toolbar/Status");

		_runBtn.Pressed += () => StartRun(_code.Text);
		_stopBtn.Pressed += () => _runner?.Stop();
		GetNode<Button>("Layout/Left/Toolbar/SampleButton").Pressed += () => LoadScript(SampleScript);
		GetNode<Button>("Layout/Left/Toolbar/LoopButton").Pressed += () => LoadScript(LoopScript);

		SetupEditor();
		_code.Text = SampleScript;

		_headless = DisplayServer.GetName() == "headless";
		if (_headless)
		{
			GD.Print("[headless] phase 1: stepped 範例腳本");
			StartRun(SampleScript);
		}
	}

	public override void _Process(double delta)
	{
		if (_runner == null) return;

		DrainEvents();

		if (_runner.PausedAtStatement)
		{
			SetHighlight(_runner.CurrentLine - 1); // CodeEdit 行號 0-based
			_status.Text = $"執行中…第 {_runner.CurrentLine} 行";
			_stepTimer += delta;
			if (_headless || _stepTimer >= StepDelaySec)
			{
				_stepTimer = 0;
				if (_headless) _headlessLines.Add(_runner.CurrentLine);
				_runner.AdvanceOneStatement();
			}
		}

		if (_runner.IsFinished)
		{
			DrainEvents();
			var state = _runner.State;
			EndRun(state);
			if (_headless) HeadlessNext(state);
		}
	}

	private void StartRun(string code)
	{
		if (_runner != null) return;
		_log.Clear();
		ClearHighlight();
		_stepTimer = 0;
		_runner = new JintRunner(code);
		_runBtn.Disabled = true;
		_stopBtn.Disabled = false;
		_code.Editable = false;
		_status.Text = "執行中…";
	}

	private void StartRunUnstepped(string code, int maxStatements)
	{
		_log.Clear();
		ClearHighlight();
		_runner = new JintRunner(code, stepped: false, maxStatements);
		_runBtn.Disabled = true;
		_stopBtn.Disabled = false;
		_code.Editable = false;
		_status.Text = "全速執行中…";
	}

	private void EndRun(JintRunner.RunState state)
	{
		_runner?.Dispose();
		_runner = null;
		_runBtn.Disabled = false;
		_stopBtn.Disabled = true;
		_code.Editable = true;
		ClearHighlight();
		_status.Text = state switch
		{
			JintRunner.RunState.Done => "完成",
			JintRunner.RunState.Stopped => "已停止",
			JintRunner.RunState.LimitExceeded => "超過 statement 上限",
			_ => "腳本錯誤",
		};
	}

	private void LoadScript(string script)
	{
		if (_runner != null) return;
		_code.Text = script;
		_log.Clear();
		_status.Text = "待機";
	}

	private void DrainEvents()
	{
		while (_runner!.TryDequeueEvent(out var evt))
		{
			var idx = evt.IndexOf('|');
			var kind = evt[..idx];
			var text = evt[(idx + 1)..];
			if (_headless)
			{
				_headlessEvents.Add(evt);
				GD.Print("  " + evt);
			}
			var color = kind switch { "act" => "#8ec07c", "log" => "#83a598", _ => "#fabd2f" };
			_log.AppendText($"[color={color}]{text.Replace("[", "[lb]")}[/color]\n");
		}
	}

	private void SetHighlight(int line)
	{
		if (line == _highlightedLine || line < 0 || line >= _code.GetLineCount()) return;
		ClearHighlight();
		_code.SetLineBackgroundColor(line, LineHighlight);
		_highlightedLine = line;
	}

	private void ClearHighlight()
	{
		if (_highlightedLine >= 0 && _highlightedLine < _code.GetLineCount())
			_code.SetLineBackgroundColor(_highlightedLine, LineClear);
		_highlightedLine = -1;
	}

	private void SetupEditor()
	{
		var hl = new CodeHighlighter
		{
			NumberColor = new Color("b5cea8"),
			SymbolColor = new Color("d4d4d4"),
			FunctionColor = new Color("dcdcaa"),
			MemberVariableColor = new Color("9cdcfe"),
		};
		var kwColor = new Color("c586c0");
		foreach (var kw in new[]
		{
			"var", "let", "const", "function", "if", "else", "for", "while", "do",
			"return", "break", "continue", "true", "false", "null", "undefined",
			"new", "typeof", "in", "of", "try", "catch", "finally", "throw", "switch", "case",
		})
			hl.AddKeywordColor(kw, kwColor);
		var commentColor = new Color("6a9955");
		var stringColor = new Color("ce9178");
		hl.AddColorRegion("//", "", commentColor, lineOnly: true);
		hl.AddColorRegion("/*", "*/", commentColor);
		hl.AddColorRegion("\"", "\"", stringColor, lineOnly: true);
		hl.AddColorRegion("'", "'", stringColor, lineOnly: true);
		hl.AddColorRegion("`", "`", stringColor);

		_code.SyntaxHighlighter = hl;
		_code.GuttersDrawLineNumbers = true;
		_code.ScrollSmooth = true;

		var mono = new SystemFont
		{
			FontNames = new[] { "Menlo", "Monaco", "Consolas", "monospace" },
		};
		_code.AddThemeFontOverride("font", mono);
		_code.AddThemeFontSizeOverride("font_size", 15);
		_log.AddThemeFontOverride("normal_font", mono);
		_log.AddThemeFontSizeOverride("normal_font_size", 14);
	}

	// ---- headless 兩階段驗收 ----

	private void HeadlessNext(JintRunner.RunState state)
	{
		if (_headlessPhase == 0)
		{
			var acts = _headlessEvents.Count(e => e.StartsWith("act|"));
			var hasEs6Log = _headlessEvents.Any(e => e.StartsWith("log|ES6"));
			var ok = state == JintRunner.RunState.Done && acts == 4 && hasEs6Log && _headlessLines.Count >= 4;
			GD.Print($"[headless] phase 1 {(ok ? "PASS" : "FAIL")}:state={state} acts={acts} es6={hasEs6Log} " +
					 $"行號={string.Join(",", _headlessLines.OrderBy(l => l))}");
			if (!ok) Quit(1);

			_headlessPhase = 1;
			_headlessEvents.Clear();
			GD.Print("[headless] phase 2: while(true) 全速 + MaxStatements");
			StartRunUnstepped(LoopScript, JintRunner.DefaultMaxStatements);
		}
		else
		{
			var ok = state == JintRunner.RunState.LimitExceeded;
			GD.Print($"[headless] phase 2 {(ok ? "PASS" : "FAIL")}:state={state}");
			GD.Print(ok ? "[headless] M0 SPIKE PASS" : "[headless] M0 SPIKE FAIL");
			Quit(ok ? 0 : 1);
		}
	}

	private void Quit(int code)
	{
		SetProcess(false);
		GetTree().Quit(code);
	}
}
