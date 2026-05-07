import click

from cli.commands.export import export_cmd
from cli.commands.session import session
from cli.commands.source import source


@click.group()
@click.version_option("0.1.0", prog_name="unilabellm")
def cli():
    """unilabellm — LLM-powered YOLO dataset unification."""


cli.add_command(session)
cli.add_command(source)
cli.add_command(export_cmd, name="export")
