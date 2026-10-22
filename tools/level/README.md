# level

Check the shape of a text file. Level tells you whether a file uses Windows
line endings, whether it carries an invisible byte order mark, whether it is
really UTF-8, whether it ends with a newline, and whether it has trailing
spaces or tab indentation. It shows you the levelled copy, line by line, and
you decide what to do about it. Level is finished and in the kit: it passes
every rule of the contract, and its tests are green.

## Why

Two files can be byte-for-byte different and mean exactly the same thing, and
the difference is invisible until it is not. A file saved by a Windows editor
carries a carriage return at the end of every line. A file saved by some other
programs starts with three bytes that are not text at all. A file that has been
edited by hand for a year has trailing spaces on the lines nobody looked at.
None of this shows up in a diff of what you meant to change, and all of it
turns into noise for the next person, and the next tool, and the next decade.

The outside world can keep a folder of plain text files for twenty years. It
keeps them as they were, quirks and all. Level is the tool that finds the
quirks while they are still cheap to fix.

## How to run it

Open `level.html` in any browser. It runs from the disk: no server, no
install, no network, no dependencies. Drop a file on the page, or paste some
text, and it shows you the findings and the levelled copy.

The same rules are on the command line, so a script can fail on them:

    node tools/level/level.js check notes.txt
    node tools/level/level.js check notes.txt --json
    node tools/level/level.js fix   notes.txt --write

`check` exits 0 when the file is the shape it should be, and 1 when it is not.
That is the whole contract with a build script: `check` on a folder of files,
and the build fails when one of them is wrong.

`fix` without `--write` prints the levelled copy on stdout and touches
nothing, so it can be used in a pipe. `fix --write` rewrites the file, and
only if you ask it to.

## What it checks

| rule | what it means |
| --- | --- |
| `crlf` | the file uses CRLF (Windows) or bare CR (classic Mac) line endings |
| `bom` | the file starts with a UTF-8 byte order mark |
| `encoding` | the file is not valid UTF-8 |
| `final-newline` | the file does not end with a newline |
| `trailing-space` | a line ends in spaces or tabs |
| `tabs` | a line is indented with a tab character |

Every one of these can be settled by looking at bytes. None of them is an
opinion about what the file should contain. Level has no opinion about line
length, quote style, naming, indentation width, or anything else that is a
matter of taste. If you want those, that is a different tool, and a different
argument.

## How it works

The engine is one file, `tools/level/level.js`, and it is the same engine in
both doors. It takes bytes in and returns plain data out: the findings, the
levelled bytes, and a line-by-line difference. It has no filesystem, no DOM,
no clock and no randomness. The page carries a copy of that file inline,
between two marker comments, and a test lifts the copy out of the page and
compares it with the source byte for byte. If the two ever drift, the test
fails and the tool does not ship. That way a stranger who asks the terminal
and the page about the same file gets the same answer, and if they do not, it
is a visible bug rather than a quiet difference.

The UTF-8 decoder is strict on purpose. Overlong forms, lone surrogates and
out-of-range code points are all rejected, because a file that claims to be
UTF-8 and is not is exactly the rot this tool exists to find.

Levelling is done in a fixed order, and each step is applied to the result of
the last: line endings first, because everything else is defined in terms of
lines; then the byte order mark, which is gone before anything else looks at
the text; then trailing whitespace; then tab indentation; then the final
newline. Levelling a levelled file changes nothing, and there is a test that
says so.

## Limits

- Level checks the shape of a text file. It does not check what the text says,
  and it does not know what the file is for.
- A file that is not valid UTF-8 is reported and left alone. Level will not
  guess what the bytes were meant to be, and it will not rewrite a file it
  could not read.
- Tabs are expanded to the next tab stop, four columns wide. If your project
  uses a different width, the indentation will not match its style, though the
  tabs will be gone.
- The `encoding` finding suppresses the other findings. With bytes that are
  not text there is no honest answer about line endings or indentation, so
  level says what it knows and stops.
- Level does not look inside the file it is given. It does not follow
  includes, does not read a project file, and does not care which language
  the file is in.
- The browser page reads the whole file into memory. It is a tool for
  documents, not for disk images.
- The page can only read files you pick, and can only save the levelled copy
  by asking your browser to save it. It cannot write beside your file. The
  command line tool can, if you ask it to.

## An example you can reproduce

Make a file with a byte order mark, Windows line endings and a trailing
space, and then look at it:

    printf '\xef\xbb\xbfone  \r\ntwo\r\n' > messy.txt
    node tools/level/level.js check messy.txt --diff

It says, in words:

    FAIL  messy.txt
      line    1  bom             the file starts with a UTF-8 byte order mark
      line    1  crlf            the file uses CRLF (Windows) line endings
      line    1  trailing-space  line 1 ends in 2 trailing spaces
      line    2  crlf            the file uses CRLF (Windows) line endings
      4 findings (bom, crlf, trailing-space)

and `node tools/level/level.js fix messy.txt` prints:

    one
    two

The command line tool and the page are the same tool, so this is the same
answer the page gives.

---

Written by plane in arc 1.
