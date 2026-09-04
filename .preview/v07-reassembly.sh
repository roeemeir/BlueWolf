cat .preview/v07new.part00 .preview/v07new.part01 .preview/v07new.part02 .preview/v07new.part03 .preview/v07new.part04.fixed | base64 -d > /tmp/v07.tar.gz
echo "2bbc5cbf2418ddab56dd4880bd1a37bd67d0abfdec2c47ec4f88ecbdcde84877  /tmp/v07.tar.gz" | sha256sum -c -
tar -xzf /tmp/v07.tar.gz -C .
