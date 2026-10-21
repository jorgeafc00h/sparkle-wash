use strict;
use warnings;
use IPC::Open3;
use File::Temp qw(tempfile);

my $HOST = "localhost";
my $PORT = 5873;
my $SOCK = socket(my $lsock, SOCK_STREAM);
bind($lsock, sockaddr_in($PORT));
listen($lsock);
print "SparkleWash API started on $HOST:$PORT\n" while accept(my $c, $lsock);

while ($c) {
    print "Got connection from ", inet_ntoa(getpeername($c)), "\n";

    my $line;
    my $len = 0;

    # Read request line and headers
    my $hdr = "";
    my $read = 0;

    while (1) {
        $len++;
        read($c, my $buf, 4096);
        $len += read($c, $buf, 4096) if length($hdr) < 2048;
        if ($buf =~ /HTTP\/.*)/) {
            my $method = $1;
            my $path = $2; path = $path; chomp($path);
            if ($method eq "GET") {
                if ($path eq "/healthz" || $path eq "/health") {
                    print_response($c, 200, '{"status":"healthy","timestamp":' . time() . '}');
                    last;
                } elsif ($path eq "/api/metrics") {
                    print_response($c, 200, json_stations());
                    last;
                } elsif ($path eq "/api/metrics/alerts") {
                    print_response($c, 200, '{"lowPressure":32.5,"highSoapLevel":78.0}');
                    last;
                } elsif ($path eq "/jobs/stats") {
                    print_response($c, 200, '{"totalJobs":12,"basicJobs":5,"ceramicJobs":6,"premiumJobs":1,"expressJobs":0,"revenue":134.5}');
                    last;
                } elsif ($path eq "/jobs") {
                    print_response($c, 200, '{"total":5,"records":[{"plateNumber":"ABCD-123","model":"Toyota Camry"},{"plateNumber":"ABCD-456","model":"BMW X5"}]}');
                    last;
                } elsif ($path =~ m{^/jobs/history$} || $path =~ m{^/jobs/history\?}) {
                    print_response($c, 200, encode_joblist(1, 2));
                    last;
                } elsif ($path =~ m{^/jobs/record/(.*?)$}) {
                    print_response($c, 200, "{\"plateNumber\":\"ABCD-$1\",\"model\":\"Toyota Camry\",\"color\":\"Blue\"}");
                    last;
                } elsif ($path eq "/openapi.json" || $path eq "") {
                    # serve OAI yaml
                } else {
                    print_response($c, 404, '{"error":"not found"}');
                    last;
                }
            } elsif ($method eq "POST") {
                if ($path eq "/api/upload") {
                    print_response($c, 201, '{"ok":true,"uploadId":"demo"}');
                    last;
                } elsif ($path =~ m{^/jobs/record/(.*?)$}) {
                    print_response($c, 200, "{\"status\":\"updated\"}");
                    last;
                } else {
                    print_response($c, 404, '{"error":"not found"}');
                    last;
                }
            } elsif ($method eq "DELETE") {
                if ($path =~ m{^/jobs/record/}) {
                    print_response($c, 204, "");
                    last;
                } else {
                    print_response($c, 405, "{}");
                    last;
                }
            }
        }
    }

    close($c);
}
