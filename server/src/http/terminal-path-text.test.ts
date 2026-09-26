import { describe, expect, test } from "bun:test";
import { terminalPathText } from "./terminal-path-text";

describe("terminal path text", () => {
  test("keeps plain POSIX paths bare", () => {
    expect(terminalPathText("/tmp/img-1-abc.png", "linux")).toBe(
      "/tmp/img-1-abc.png",
    );
  });

  test("single-quotes POSIX paths with spaces or shell characters", () => {
    expect(terminalPathText("/var/folders/My Temp/$x/img.png", "darwin")).toBe(
      "'/var/folders/My Temp/$x/img.png'",
    );
    expect(terminalPathText("/tmp/o'brien/img.png", "linux")).toBe(
      "'/tmp/o'\\''brien/img.png'",
    );
  });

  test("uses forward slashes for Windows paths", () => {
    expect(
      terminalPathText(
        "C:\\Users\\me\\AppData\\Local\\Temp\\roamgate-images-a1\\img.png",
        "win32",
      ),
    ).toBe("C:/Users/me/AppData/Local/Temp/roamgate-images-a1/img.png");
  });

  test("single-quotes Windows paths with spaces", () => {
    expect(
      terminalPathText("C:\\Users\\John Doe\\Temp\\img.png", "win32"),
    ).toBe("'C:/Users/John Doe/Temp/img.png'");
  });

  test("double-quotes Windows paths with apostrophes", () => {
    expect(terminalPathText("C:\\Users\\O'Brien\\Temp\\img.png", "win32")).toBe(
      '"C:/Users/O\'Brien/Temp/img.png"',
    );
  });

  test("falls back to PowerShell quoting when both quote styles expand", () => {
    expect(terminalPathText("C:\\Users\\O'B$n\\img.png", "win32")).toBe(
      "'C:/Users/O''B$n/img.png'",
    );
  });
});
