using System.Text;
using LalamoMado.Cli;

var utf8 = new UTF8Encoding(false);
Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true });
Console.SetIn(new StreamReader(Console.OpenStandardInput(), utf8));
return await Commands.RunAsync(args);
