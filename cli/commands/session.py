from __future__ import annotations

import click
from rich.console import Console
from rich.table import Table

from core.config import settings
from core.harmonizer import session as session_mgr
from core.harmonizer.mapper import build_canonical_classes
from core.harmonizer.validator import validate
from core.llm.analyzer import SemanticAnalyzer
from core.parser.yolo import parse_dataset

console = Console()


@click.group()
def session():
    """Harmonization session management."""


@session.command("new")
@click.option("--sources", "-s", multiple=True, required=True, help="Dataset paths")
@click.option("--name", "-n", multiple=True, help="Optional dataset names (same order as --sources)")
@click.option("--domain", "-d", default=None, help="Domain hint for LLM (e.g. traffic, medical)")
def session_new(sources, name, domain):
    """Create a new harmonization session from source datasets."""
    settings.ensure_workspace()

    names = list(name) + [None] * (len(sources) - len(name))
    dataset_sources = []
    for path, ds_name in zip(sources, names):
        console.print(f"[cyan]Parsing[/cyan] {path}...")
        try:
            ds = parse_dataset(path, name=ds_name)
            dataset_sources.append(ds)
            console.print(f"  ✓ {ds.name}: {len(ds.classes)} classes, {ds.image_count} images")
        except Exception as e:
            console.print(f"  [red]✗ Error:[/red] {e}")
            raise click.Abort()

    console.print("\n[cyan]Running LLM semantic analysis...[/cyan]")
    try:
        analyzer = SemanticAnalyzer()
        dataset_classes = {ds.name: ds.classes for ds in dataset_sources}
        result = analyzer.analyze(dataset_classes, domain_hint=domain)
    except Exception as e:
        console.print(f"[red]LLM analysis failed:[/red] {e}")
        raise click.Abort()

    canonical_classes = build_canonical_classes(result, dataset_sources)

    new_session = session_mgr.create_session(dataset_sources)
    new_session.canonical_classes = canonical_classes
    new_session.status = "reviewing"
    session_mgr.save_session(new_session)

    console.print(f"\n[green]Session created:[/green] {new_session.id}")
    console.print(f"  Status: {new_session.status}")
    console.print(f"  Canonical classes: {len(canonical_classes)}")
    if result.unmapped:
        console.print(f"  [yellow]Unmapped labels:[/yellow] {', '.join(result.unmapped)}")


@session.command("list")
def session_list():
    """List all harmonization sessions."""
    sessions = session_mgr.list_sessions()
    if not sessions:
        console.print("[dim]No sessions found.[/dim]")
        return

    table = Table(title="Harmonization Sessions")
    table.add_column("ID", style="cyan", no_wrap=True)
    table.add_column("Status", style="bold")
    table.add_column("Sources")
    table.add_column("Classes")
    table.add_column("Created")

    for s in sessions:
        status_color = {
            "pending": "yellow",
            "reviewing": "blue",
            "confirmed": "green",
            "exported": "dim",
        }.get(s.status, "white")
        table.add_row(
            s.id[:8] + "…",
            f"[{status_color}]{s.status}[/{status_color}]",
            str(len(s.sources)),
            str(len(s.canonical_classes)),
            s.created_at.strftime("%Y-%m-%d %H:%M"),
        )
    console.print(table)


@session.command("show")
@click.argument("session_id")
def session_show(session_id):
    """Show details of a session."""
    try:
        s = session_mgr.load_session(session_id)
    except FileNotFoundError:
        console.print(f"[red]Session not found:[/red] {session_id}")
        raise click.Abort()

    console.print(f"\n[bold]Session:[/bold] {s.id}")
    console.print(f"[bold]Status:[/bold]  {s.status}")
    console.print(f"[bold]Created:[/bold] {s.created_at.strftime('%Y-%m-%d %H:%M:%S')}")

    console.print(f"\n[bold]Sources ({len(s.sources)}):[/bold]")
    for src in s.sources:
        console.print(f"  • {src.name}: {len(src.classes)} classes, {src.image_count} images")

    console.print(f"\n[bold]Canonical Classes ({len(s.canonical_classes)}):[/bold]")
    for cc in s.canonical_classes:
        conf_color = "green" if cc.confidence >= 0.8 else "yellow" if cc.confidence >= 0.5 else "red"
        console.print(
            f"  [{conf_color}]{cc.id:3d}[/{conf_color}] {cc.name:25s} "
            f"← {', '.join(cc.aliases[:5])}{'…' if len(cc.aliases) > 5 else ''} "
            f"[dim](conf={cc.confidence:.2f})[/dim]"
        )

    validation = validate(s.canonical_classes, s.sources)
    if not validation.valid:
        console.print(f"\n[yellow]⚠ Validation:[/yellow] {validation.summary()}")
    else:
        console.print("\n[green]✓ Validation passed[/green]")


@session.command("confirm")
@click.argument("session_id")
def session_confirm(session_id):
    """Confirm a session, marking it ready for export."""
    try:
        s = session_mgr.load_session(session_id)
    except FileNotFoundError:
        console.print(f"[red]Session not found:[/red] {session_id}")
        raise click.Abort()

    validation = validate(s.canonical_classes, s.sources)
    if not validation.valid:
        console.print(f"[red]Cannot confirm:[/red] {validation.summary()}")
        console.print("Fix unmapped labels or conflicts first.")
        raise click.Abort()

    try:
        s.transition("confirmed")
    except ValueError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise click.Abort()

    session_mgr.save_session(s)
    console.print(f"[green]✓ Session {session_id[:8]}… confirmed.[/green]")
