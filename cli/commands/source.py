from __future__ import annotations

import click
from rich.console import Console
from rich.table import Table

from core.sources.manager import SourceManager
from core.workspace.manager import WorkspaceManager

console = Console()


@click.group()
def source():
    """Manage dataset sources (local, Kaggle, Roboflow, URL)."""


@source.command("status")
def source_status():
    """Show which external source integrations are available."""
    manager = SourceManager()
    availability = manager.check_availability()

    table = Table(title="Source Provider Status")
    table.add_column("Provider")
    table.add_column("Available")
    table.add_column("Notes")

    labels = {
        "kaggle": "Kaggle",
        "roboflow": "Roboflow Universe",
        "url": "URL / Direct Download",
    }
    for key, (ok, reason) in availability.items():
        status = "[green]✓ Ready[/green]" if ok else "[red]✗ Not available[/red]"
        table.add_row(labels[key], status, reason or "—")
    console.print(table)


@source.command("add")
@click.option("--local", "-l", default=None, metavar="PATH",
              help="Local dataset folder path")
@click.option("--kaggle", "-k", default=None, metavar="OWNER/DATASET",
              help="Kaggle dataset identifier, e.g. ultralytics/coco128")
@click.option("--roboflow", "-r", default=None, metavar="WORKSPACE/PROJECT[/VERSION]",
              help="Roboflow project, e.g. roboflow-100/cells-oc7bq")
@click.option("--url", "-u", default=None, metavar="URL",
              help="Direct URL to a zip/tar archive")
@click.option("--name", "-n", default=None, help="Override dataset name")
@click.option("--format", "rf_format", default="yolov8", show_default=True,
              help="Roboflow export format (yolov8, yolov5)")
def source_add(local, kaggle, roboflow, url, name, rf_format):
    """Add a dataset from a local folder, Kaggle, Roboflow, or a URL."""
    sources_given = sum(x is not None for x in [local, kaggle, roboflow, url])
    if sources_given != 1:
        console.print("[red]Provide exactly one of --local, --kaggle, --roboflow, or --url[/red]")
        raise click.Abort()

    if local:
        _add_local(local, name)
    elif kaggle:
        _add_kaggle(kaggle, name)
    elif roboflow:
        _add_roboflow(roboflow, name, rf_format)
    elif url:
        _add_url(url, name)


@source.command("list")
def source_list():
    """List all datasets in the workspace."""
    wm = WorkspaceManager()
    datasets = wm.list_datasets()

    if not datasets:
        console.print("[dim]No datasets in workspace. Use 'source add' to add one.[/dim]")
        return

    table = Table(title="Workspace Datasets")
    table.add_column("Name", style="cyan")
    table.add_column("Classes", justify="right")
    table.add_column("Images", justify="right")
    table.add_column("Labels", justify="right")
    table.add_column("Path")

    for ds in datasets:
        table.add_row(
            ds.name,
            str(len(ds.classes)),
            str(ds.image_count),
            str(ds.label_count),
            ds.path,
        )
    console.print(table)


@source.command("remove")
@click.argument("name")
def source_remove(name):
    """Remove a dataset from the workspace index (does not delete files)."""
    wm = WorkspaceManager()
    wm.remove_dataset(name)
    console.print(f"[green]✓ Removed '{name}' from workspace index.[/green]")


@source.command("rescan")
@click.argument("name")
def source_rescan(name):
    """Rescan an existing workspace dataset to refresh its metadata."""
    wm = WorkspaceManager()
    try:
        ds = wm.rescan_dataset(name)
        console.print(
            f"[green]✓ Rescanned '{ds.name}':[/green] "
            f"{len(ds.classes)} classes, {ds.image_count} images"
        )
    except KeyError:
        console.print(f"[red]Dataset '{name}' not found in workspace.[/red]")
        raise click.Abort()


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _add_local(path: str, name: str | None) -> None:
    from core.workspace.manager import WorkspaceManager

    console.print(f"[cyan]Scanning[/cyan] {path}…")
    try:
        wm = WorkspaceManager()
        ds = wm.add_dataset(path, name=name)
        _print_success(ds)
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise click.Abort()


def _add_kaggle(identifier: str, name: str | None) -> None:
    manager = SourceManager()
    ok, reason = manager._providers["kaggle"].is_available()
    if not ok:
        console.print(f"[red]Kaggle not available:[/red] {reason}")
        _print_kaggle_setup()
        raise click.Abort()

    console.print(f"[cyan]Downloading from Kaggle:[/cyan] {identifier}")
    console.print("[dim]This may take a while depending on dataset size…[/dim]")
    try:
        ds = manager.add_from_kaggle(identifier, name=name)
        _print_success(ds)
    except Exception as e:
        console.print(f"[red]Kaggle download failed:[/red] {e}")
        raise click.Abort()


def _add_roboflow(identifier: str, name: str | None, fmt: str) -> None:
    manager = SourceManager()
    ok, reason = manager._providers["roboflow"].is_available()
    if not ok:
        console.print(f"[red]Roboflow not available:[/red] {reason}")
        _print_roboflow_setup()
        raise click.Abort()

    console.print(f"[cyan]Downloading from Roboflow:[/cyan] {identifier}")
    try:
        ds = manager.add_from_roboflow(identifier, name=name, format=fmt)
        _print_success(ds)
    except Exception as e:
        console.print(f"[red]Roboflow download failed:[/red] {e}")
        raise click.Abort()


def _add_url(url: str, name: str | None) -> None:
    manager = SourceManager()
    console.print(f"[cyan]Downloading from URL:[/cyan] {url}")
    console.print("[dim]This may take a while depending on dataset size…[/dim]")
    try:
        ds = manager.add_from_url(url, name=name)
        _print_success(ds)
    except Exception as e:
        console.print(f"[red]URL download failed:[/red] {e}")
        raise click.Abort()


def _print_success(ds) -> None:
    console.print(f"\n[green]✓ Dataset added:[/green] {ds.name}")
    console.print(f"  Classes ({len(ds.classes)}): {', '.join(ds.classes[:8])}"
                  + ("…" if len(ds.classes) > 8 else ""))
    console.print(f"  Images:  {ds.image_count}")
    console.print(f"  Labels:  {ds.label_count}")
    console.print(f"  Path:    {ds.path}")


def _print_kaggle_setup() -> None:
    console.print(
        "\n[bold]Kaggle setup:[/bold]\n"
        "  1. Install:   [cyan]pip install kaggle[/cyan]\n"
        "  2. API token: https://www.kaggle.com/settings → API → Create New Token\n"
        "  3. Place [cyan]kaggle.json[/cyan] at [cyan]~/.kaggle/kaggle.json[/cyan]\n"
        "     or set env vars: [cyan]KAGGLE_USERNAME[/cyan] + [cyan]KAGGLE_KEY[/cyan]\n"
    )


def _print_roboflow_setup() -> None:
    console.print(
        "\n[bold]Roboflow setup:[/bold]\n"
        "  1. Install:   [cyan]pip install roboflow[/cyan]\n"
        "  2. API key:   https://app.roboflow.com → Settings → Roboflow API\n"
        "  3. Set env:   [cyan]ROBOFLOW_API_KEY=your_key[/cyan] in .env\n"
    )
