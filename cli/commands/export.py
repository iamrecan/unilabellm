from __future__ import annotations

import click
from rich.console import Console
from rich.table import Table

from core.exporter.yolo import export_dataset
from core.harmonizer import session as session_mgr
from core.models import ExportConfig

console = Console()


@click.command("export")
@click.argument("session_id")
@click.option("--output", "-o", required=True, help="Output directory for the unified dataset")
@click.option("--split", nargs=3, type=float, default=(0.7, 0.2, 0.1), show_default=True,
              help="Train/val/test split ratios")
@click.option("--seed", default=42, show_default=True, help="Random seed for reproducibility")
def export_cmd(session_id, output, split, seed):
    """Export a confirmed session as a unified YOLO dataset."""
    try:
        s = session_mgr.load_session(session_id)
    except FileNotFoundError:
        console.print(f"[red]Session not found:[/red] {session_id}")
        raise click.Abort()

    if s.status not in ("confirmed", "exported"):
        console.print(
            f"[red]Session is '{s.status}' — must be 'confirmed' before export.[/red]"
        )
        raise click.Abort()

    total = sum(split)
    if abs(total - 1.0) > 0.01:
        console.print(f"[red]Split ratios must sum to 1.0, got {total:.2f}[/red]")
        raise click.Abort()

    config = ExportConfig(output_path=output, split_ratio=tuple(split), seed=seed)

    console.print(f"[cyan]Exporting session {session_id[:8]}…[/cyan]")
    console.print(f"  Output: {output}")
    console.print(f"  Split:  train={split[0]:.0%} val={split[1]:.0%} test={split[2]:.0%}")

    try:
        summary = export_dataset(s, config)
    except Exception as e:
        console.print(f"[red]Export failed:[/red] {e}")
        raise click.Abort()

    s.transition("exported")
    session_mgr.save_session(s)

    table = Table(title="Export Summary")
    table.add_column("Split", style="bold")
    table.add_column("Images", justify="right")
    for split_name, count in summary.split_counts.items():
        table.add_row(split_name, str(count))
    console.print(table)

    console.print("\n[bold]Class distribution:[/bold]")
    for cls, count in sorted(summary.class_counts.items(), key=lambda x: -x[1]):
        console.print(f"  {cls:30s} {count:6d} annotations")

    if summary.duplicate_count:
        console.print(f"\n[yellow]⚠ {summary.duplicate_count} near-duplicate images detected[/yellow]")

    console.print(f"\n[green]✓ Export complete:[/green] {output}")
