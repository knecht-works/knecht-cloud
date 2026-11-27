-- Favicons read from a git symlink hold its target path instead of image bytes.
-- Every real image payload starts with its format's signature; clearing the rest lets the next preview detect them again.
UPDATE `projects` SET `favicon` = NULL
WHERE (`favicon` GLOB 'data:image/svg+xml;base64,*' AND NOT `favicon` GLOB 'data:image/svg+xml;base64,[PICD7]*')
  OR (`favicon` GLOB 'data:image/png;base64,*' AND NOT `favicon` GLOB 'data:image/png;base64,iVBOR*')
  OR (`favicon` GLOB 'data:image/x-icon;base64,*' AND NOT `favicon` GLOB 'data:image/x-icon;base64,AAAB*' AND NOT `favicon` GLOB 'data:image/x-icon;base64,iVBOR*');
