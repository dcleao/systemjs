mkdir -p dist/extras
cp src/extras/* dist/extras/
cd dist/extras
rm *.min.js
for f in *.js
do
  short=${f%.js}
  if [ short = "amd2" ]
  then
    ../../node_modules/.bin/terser $f -c "passes=2,keep_fargs=false" -m keep_fnames='/Node$/' --mangle-props regex='/^(__|[$])(?!useDefault)/'
  else
    ../../node_modules/.bin/terser $f -c passes=2 -m --source-map -o $short.min.js
  fi
done
